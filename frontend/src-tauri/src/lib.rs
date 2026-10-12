#[cfg(all(not(debug_assertions), target_os = "windows"))]
use std::{
    fs::{create_dir_all, OpenOptions},
    net::{TcpListener, TcpStream},
    os::windows::process::CommandExt,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
#[cfg(all(not(debug_assertions), target_os = "windows"))]
use tauri::Manager;

struct BackendProcess {
    port: u16,
    #[cfg(all(not(debug_assertions), target_os = "windows"))]
    child: Mutex<Child>,
}

#[tauri::command]
fn backend_port(backend: tauri::State<'_, BackendProcess>) -> u16 {
    backend.port
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_process::init())?;
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            #[cfg(all(not(debug_assertions), target_os = "windows"))]
            {
                let app_data_dir = app.path().app_data_dir()?;
                create_dir_all(&app_data_dir)?;
                let projects_dir = app_data_dir.join("projects");
                let model_cache_dir = app_data_dir.join("models");
                let log_path = app_data_dir.join("backend.log");
                create_dir_all(&projects_dir)?;
                create_dir_all(&model_cache_dir)?;
                let backend_log = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)?;
                let backend = app.path().resource_dir()?.join("cliprobin-api.exe");
                let listener = TcpListener::bind(("127.0.0.1", 0))?;
                let port = listener.local_addr()?.port();
                drop(listener);
                let mut child = Command::new(backend)
                    .env("CLIPROBIN_PROJECTS_DIR", projects_dir)
                    .env("CLIPROBIN_API_PORT", port.to_string())
                    .env("HF_HOME", model_cache_dir)
                    .stdout(Stdio::from(backend_log.try_clone()?))
                    .stderr(Stdio::from(backend_log))
                    .creation_flags(0x08000000)
                    .spawn()?;
                let startup_deadline = Instant::now() + Duration::from_secs(30);
                loop {
                    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                        break;
                    }
                    if let Some(status) = child.try_wait()? {
                        return Err(std::io::Error::other(format!(
                            "The Clip Robin backend exited during startup ({status}). See {}.",
                            log_path.display()
                        ))
                        .into());
                    }
                    if Instant::now() >= startup_deadline {
                        if let Err(error) = child.kill() {
                            log::error!("Could not stop the stalled Clip Robin backend: {error}");
                        }
                        if let Err(error) = child.wait() {
                            log::error!(
                                "Could not wait for the stalled Clip Robin backend: {error}"
                            );
                        }
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            format!(
                                "The Clip Robin backend did not start within 30 seconds. See {}.",
                                log_path.display()
                            ),
                        )
                        .into());
                    }
                    thread::sleep(Duration::from_millis(250));
                }
                app.manage(BackendProcess {
                    port,
                    child: Mutex::new(child),
                });
            }

            #[cfg(not(all(not(debug_assertions), target_os = "windows")))]
            app.manage(BackendProcess { port: 8000 });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_port])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            #[cfg(all(not(debug_assertions), target_os = "windows"))]
            if let tauri::RunEvent::Exit = event {
                if let Some(backend) = app_handle.try_state::<BackendProcess>() {
                    if let Ok(mut child) = backend.child.lock() {
                        if let Err(error) = child.kill() {
                            log::error!("Could not stop the Clip Robin backend: {error}");
                        }
                        if let Err(error) = child.wait() {
                            log::error!("Could not wait for the Clip Robin backend: {error}");
                        }
                    }
                }
            }
        });
}
