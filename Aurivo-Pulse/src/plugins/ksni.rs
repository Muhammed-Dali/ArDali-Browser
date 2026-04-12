use crate::core::thread_messages::GUIMessage;
use gettextrs::gettext;
use ksni::TrayMethods;

pub struct SystrayInterface {
    pub gui_tx: async_channel::Sender<GUIMessage>,
}

impl ksni::Tray for SystrayInterface {
    fn id(&self) -> String {
        "aurivo-pulse".into()
    }
    fn icon_name(&self) -> String {
        "com.aurivo.mediaplayer".into()
    }
    fn title(&self) -> String {
        "Aurivo-Pulse".into()
    }
    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::*;
        vec![
            StandardItem {
                label: gettext("Open Aurivo-Pulse").into(),
                activate: Box::new(|tray: &mut Self| {
                    tray.gui_tx.try_send(GUIMessage::ShowWindow).unwrap();
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: gettext("Quit...").into(),
                activate: Box::new(|tray: &mut Self| {
                    tray.gui_tx.try_send(GUIMessage::QuitApplication).unwrap();
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

impl SystrayInterface {
    pub async fn try_enable(
        gui_tx: async_channel::Sender<GUIMessage>,
    ) -> Result<ksni::Handle<Self>, ksni::Error> {
        match std::env::var("SNAP_NAME") {
            Ok(_) => {
                Self { gui_tx }
                    .disable_dbus_name(true)
                    .assume_sni_available(true)
                    .spawn()
                    .await
            }
            _ => Self { gui_tx }.disable_dbus_name(true).spawn().await,
        }
    }

    pub async fn disable(handle: &ksni::Handle<Self>) {
        handle.shutdown().await;
    }
}
