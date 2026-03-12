mod imp;

glib::wrapper! {
    pub struct ListedDevice(ObjectSubclass<imp::ListedDevice>);
}

impl ListedDevice {
    pub fn new(
        display_name: String,
        indicator_markup: String,
        inner_name: String,
        is_monitor: bool,
    ) -> Self {
        glib::Object::builder()
            .property("display_name", display_name)
            .property("indicator_markup", indicator_markup)
            .property("inner_name", inner_name)
            .property("is_monitor", is_monitor)
            .build()
    }
}
