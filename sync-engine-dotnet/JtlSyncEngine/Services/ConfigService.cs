using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using JtlSyncEngine.Models;
using Newtonsoft.Json;

namespace JtlSyncEngine.Services
{
    public class ConfigService
    {
        private static readonly string AppDataPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "JTL-Sync");

        private static readonly string SettingsFile = Path.Combine(AppDataPath, "settings.json");
        private static readonly string SecretsFile = Path.Combine(AppDataPath, "secrets.dat");

        private AppSettings _settings = new();
        private SecretSettings _secrets = new();

        public AppSettings Settings => _settings;
        public SecretSettings Secrets => _secrets;

        public ConfigService()
        {
            EnsureDirectories();
            Load();
        }

        private void EnsureDirectories()
        {
            Directory.CreateDirectory(AppDataPath);
            Directory.CreateDirectory(Path.Combine(AppDataPath, "watermarks"));
            Directory.CreateDirectory(Path.Combine(AppDataPath, "logs"));
            Directory.CreateDirectory(Path.Combine(AppDataPath, "failed-batches"));
        }

        public void Load()
        {
            try
            {
                if (File.Exists(SettingsFile))
                {
                    var json = File.ReadAllText(SettingsFile);
                    _settings = JsonConvert.DeserializeObject<AppSettings>(json) ?? new AppSettings();
                }
                else
                {
                    _settings = new AppSettings();
                }
            }
            catch
            {
                _settings = new AppSettings();
            }

            try
            {
                if (File.Exists(SecretsFile))
                {
                    var encryptedBytes = File.ReadAllBytes(SecretsFile);
                    var decryptedBytes = ProtectedData.Unprotect(encryptedBytes, null, DataProtectionScope.CurrentUser);
                    var json = Encoding.UTF8.GetString(decryptedBytes);
                    _secrets = JsonConvert.DeserializeObject<SecretSettings>(json) ?? new SecretSettings();
                }
                else
                {
                    _secrets = new SecretSettings();
                }
            }
            catch
            {
                _secrets = new SecretSettings();
            }
        }

        public void Save(AppSettings settings, SecretSettings secrets)
        {
            _settings = settings;
            _secrets = secrets;

            try
            {
                var settingsJson = JsonConvert.SerializeObject(settings, Formatting.Indented);
                File.WriteAllText(SettingsFile, settingsJson);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Failed to save settings: {ex.Message}", ex);
            }

            try
            {
                var secretsJson = JsonConvert.SerializeObject(secrets);
                var plainBytes = Encoding.UTF8.GetBytes(secretsJson);
                var encryptedBytes = ProtectedData.Protect(plainBytes, null, DataProtectionScope.CurrentUser);
                File.WriteAllBytes(SecretsFile, encryptedBytes);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Failed to save secrets: {ex.Message}", ex);
            }
        }

        public string BuildConnectionString()
        {
            if (_settings.SqlWindowsAuth)
            {
                return $"Server={_settings.SqlHost},{_settings.SqlPort};" +
                       $"Database={_settings.SqlDatabase};" +
                       $"Integrated Security=True;" +
                       $"TrustServerCertificate=True;" +
                       $"Connect Timeout=30;";
            }
            else
            {
                return $"Server={_settings.SqlHost},{_settings.SqlPort};" +
                       $"Database={_settings.SqlDatabase};" +
                       $"User Id={_settings.SqlUsername};" +
                       $"Password={_secrets.SqlPassword};" +
                       $"TrustServerCertificate=True;" +
                       $"Connect Timeout=30;";
            }
        }

        public static string AppDataDirectory => AppDataPath;
    }
}
