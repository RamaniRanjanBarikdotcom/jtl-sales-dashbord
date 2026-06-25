using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using JtlSyncEngine.Models;
using Microsoft.Win32;
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
            // Named instances (HOST\INSTANCE) must NOT include port —
            // SQL Server Browser resolves the dynamic port automatically.
            // For default instances: only append port if it is non-zero and non-default (1433),
            // or if the user explicitly set a non-standard port.
            // Port 0 means "not specified" — let SQL Server use its default.
            string serverPart;
            if (_settings.SqlHost.Contains('\\'))
            {
                // Named instance — never include port, SQL Browser handles it
                serverPart = _settings.SqlHost;
            }
            else if (_settings.SqlPort > 0)
            {
                serverPart = $"{_settings.SqlHost},{_settings.SqlPort}";
            }
            else
            {
                // Port not set — connect without port (uses SQL Server default 1433)
                serverPart = _settings.SqlHost;
            }

            if (_settings.SqlWindowsAuth)
            {
                return $"Server={serverPart};" +
                       $"Database={_settings.SqlDatabase};" +
                       $"Integrated Security=True;" +
                       $"TrustServerCertificate=True;" +
                       $"Connect Timeout=30;";
            }
            else
            {
                return $"Server={serverPart};" +
                       $"Database={_settings.SqlDatabase};" +
                       $"User Id={_settings.SqlUsername};" +
                       $"Password={_secrets.SqlPassword};" +
                       $"TrustServerCertificate=True;" +
                       $"Connect Timeout=30;";
            }
        }

        public static string AppDataDirectory => AppDataPath;

        public static JtlDbDetectionResult? TryDetectJtlDatabase()
        {
            // Registry paths JTL Wawi uses across different versions
            string[] regPaths =
            {
                @"SOFTWARE\WOW6432Node\JTL-Software\JTL-Wawi",
                @"SOFTWARE\JTL-Software\JTL-Wawi",
                @"SOFTWARE\WOW6432Node\Jtl\Wawi",
                @"SOFTWARE\Jtl\Wawi",
                @"SOFTWARE\WOW6432Node\JTL-Software\JTL-Wawi\Database",
                @"SOFTWARE\JTL-Software\JTL-Wawi\Database",
            };

            // Value name variants across JTL versions
            string[] serverKeys = { "DBServer", "ServerName", "Server", "SqlServer", "Servername", "cServer" };
            string[] dbKeys     = { "DBName", "Datenbankname", "Database", "DatabaseName", "cDatenbank", "cDBName" };
            string[] userKeys   = { "DBUser", "Benutzer", "User", "UserName", "cBenutzer", "cUser" };
            string[] passKeys   = { "DBPassword", "Passwort", "Password", "cPasswort", "cPassword" };

            foreach (var path in regPaths)
            {
                RegistryKey? key = null;
                try
                {
                    key = Registry.LocalMachine.OpenSubKey(path)
                       ?? Registry.CurrentUser.OpenSubKey(path);

                    if (key == null) continue;

                    var server = ReadFirstValue(key, serverKeys);
                    if (string.IsNullOrWhiteSpace(server)) continue;

                    var db   = ReadFirstValue(key, dbKeys)   ?? "eazybusiness";
                    var user = ReadFirstValue(key, userKeys) ?? "";
                    var pass = ReadFirstValue(key, passKeys) ?? "";

                    // Parse host and optional port from "HOST,PORT" or "HOST\INSTANCE,PORT"
                    // Keep HOST\INSTANCE intact — named instances need the backslash
                    int port = 1433;
                    var host = server.Trim();
                    if (host.Contains(','))
                    {
                        var parts = host.Split(',');
                        host = parts[0].Trim(); // preserves HOST\INSTANCE
                        int.TryParse(parts[1].Trim(), out port);
                    }

                    return new JtlDbDetectionResult
                    {
                        Host = host,
                        Port = port,
                        Database = db,
                        Username = user,
                        Password = pass,
                        WindowsAuth = string.IsNullOrEmpty(user),
                        Source = $"Registry: {path}"
                    };
                }
                catch { }
                finally { key?.Dispose(); }
            }

            // Fallback: check if SQL Server is installed locally via registry
            if (IsSqlServerInstalledLocally())
            {
                return new JtlDbDetectionResult
                {
                    Host = "localhost",
                    Port = 1433,
                    Database = "eazybusiness",
                    Username = "",
                    Password = "",
                    WindowsAuth = true,
                    Source = "Local SQL Server detected"
                };
            }

            return null;
        }

        private static string? ReadFirstValue(RegistryKey key, string[] names)
        {
            foreach (var name in names)
            {
                var val = key.GetValue(name) as string;
                if (!string.IsNullOrWhiteSpace(val)) return val;
            }
            return null;
        }

        private static bool IsSqlServerInstalledLocally()
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\Microsoft\Microsoft SQL Server");
                return key != null;
            }
            catch { return false; }
        }
    }

    public class JtlDbDetectionResult
    {
        public string Host { get; set; } = "localhost";
        public int Port { get; set; } = 1433;
        public string Database { get; set; } = "eazybusiness";
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
        public bool WindowsAuth { get; set; }
        public string Source { get; set; } = "";
    }
}
