pub trait Vault: Send + Sync {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}
pub struct KeyringVault;

#[cfg(target_os = "linux")]
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("dev.personal.mail.outlook", "personal-account").map_err(|_| {
        "GNOME Keyring is unavailable. Unlock your login keyring and try again.".into()
    })
}
#[cfg(target_os = "linux")]
impl Vault for KeyringVault {
    fn read(&self) -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(
                "Could not read Outlook credentials. Unlock GNOME Keyring and try again.".into(),
            ),
        }
    }
    fn write(&self, value: &str) -> Result<(), String> {
        entry()?.set_password(value).map_err(|_| {
            "Could not save Outlook sign-in in GNOME Keyring. No file-storage fallback is used."
                .into()
        })
    }
    fn delete(&self) -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(
                "Could not remove Outlook credentials. Unlock GNOME Keyring and try again.".into(),
            ),
        }
    }
}
#[cfg(not(target_os = "linux"))]
impl Vault for KeyringVault {
    fn read(&self) -> Result<Option<String>, String> {
        Err("Outlook sign-in is available in the Linux desktop app.".into())
    }
    fn write(&self, _: &str) -> Result<(), String> {
        self.read().map(|_| ())
    }
    fn delete(&self) -> Result<(), String> {
        self.read().map(|_| ())
    }
}
