using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using JtlSyncEngine.Models;
using JtlSyncEngine.Runtime;
using Microsoft.Data.SqlClient;
using Microsoft.Win32;
using Newtonsoft.Json;

namespace JtlSyncEngine.Services
{
    public class ConfigService
    {
        private static string AppDataPath => RuntimePaths.CurrentRoot;
        private static string SettingsFile => RuntimePaths.IsServiceMode
            ? Path.Combine(AppDataPath, "config", "settings.json")
            : Path.Combine(AppDataPath, "settings.json");
        private static string SecretsFile => RuntimePaths.IsServiceMode
            ? Path.Combine(AppDataPath, "secrets", "secrets.dat")
            : Path.Combine(AppDataPath, "secrets.dat");

        private AppSettings _settings = new();
        private SecretSettings _secrets = new();
        private readonly List<string> _loadErrors = new();

        public AppSettings Settings => _settings;
        public SecretSettings Secrets => _secrets;
        public IReadOnlyList<string> LoadErrors => _loadErrors;
        public bool IsValid => _loadErrors.Count == 0;

        public ConfigService()
        {
            EnsureDirectories();
            Load();
        }

        private void EnsureDirectories()
        {
            RuntimePaths.EnsureCurrentLayout();
        }

        public void Load()
        {
            _loadErrors.Clear();
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
            catch (Exception)
            {
                _settings = new AppSettings();
                _loadErrors.Add("Settings file is unreadable or invalid.");
            }

            try
            {
                if (File.Exists(SecretsFile))
                {
                    var encryptedBytes = File.ReadAllBytes(SecretsFile);
                    var decryptedBytes = ProtectedData.Unprotect(encryptedBytes, null, RuntimePaths.SecretScope);
                    var json = Encoding.UTF8.GetString(decryptedBytes);
                    _secrets = JsonConvert.DeserializeObject<SecretSettings>(json) ?? new SecretSettings();
                }
                else
                {
                    _secrets = new SecretSettings();
                }
            }
            catch (Exception)
            {
                _secrets = new SecretSettings();
                _loadErrors.Add("Secrets file cannot be decrypted or is invalid.");
            }

            NormalizeLoadedSettings();
        }

        private void NormalizeLoadedSettings()
        {
            _settings.Updates ??= new UpdateSettings();
            _settings.Updates.Channel =
                string.Equals(_settings.Updates.Channel, "beta", StringComparison.OrdinalIgnoreCase)
                    ? "beta"
                    : "stable";
            _settings.Updates.HealthTimeoutSeconds =
                Math.Clamp(_settings.Updates.HealthTimeoutSeconds, 30, 900);
            _settings.Updates.KeepBackups = Math.Clamp(_settings.Updates.KeepBackups, 1, 5);
            _settings.Updates.MaximumPackageBytes =
                Math.Clamp(_settings.Updates.MaximumPackageBytes, 10 * 1024 * 1024, 2L * 1024 * 1024 * 1024);
            if (string.IsNullOrWhiteSpace(_settings.Updates.ManifestPublicKeyPem))
            {
                var trustedKeyPath = Path.Combine(AppContext.BaseDirectory,"manifest-public-key.pem");
                if (File.Exists(trustedKeyPath))
                    _settings.Updates.ManifestPublicKeyPem = File.ReadAllText(trustedKeyPath).Trim();
            }
            _settings.InventorySourceMode = "auto";
            var zeroPolicy = (_settings.InventoryZeroStockPolicy ?? string.Empty).Trim().ToLowerInvariant();
            _settings.InventoryZeroStockPolicy = zeroPolicy == "allow" ? "allow" : "verify";
            _settings.InventoryAllowConfirmedZeroStock = _settings.InventoryZeroStockPolicy == "allow";
            _settings.InventoryRejectUnverifiedZeroStock = true;
            _settings.InventoryRejectConflictingStockSources = true;
            _settings.InventoryRequireSourceMetadata = true;
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
                var encryptedBytes = ProtectedData.Protect(plainBytes, null, RuntimePaths.SecretScope);
                File.WriteAllBytes(SecretsFile, encryptedBytes);
                _loadErrors.Clear();
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Failed to save secrets: {ex.Message}", ex);
            }
        }

        public string BuildConnectionString()
        {
            var builder = new SqlConnectionStringBuilder
            {
                DataSource = BuildSqlServerPart(),
                InitialCatalog = _settings.SqlDatabase.Trim(),
                IntegratedSecurity = _settings.SqlWindowsAuth,
                ApplicationIntent = ApplicationIntent.ReadOnly,
                TrustServerCertificate = true,
                ConnectTimeout = 15,
                Pooling = true,
                MaxPoolSize = 20,
            };
            if (!_settings.SqlWindowsAuth)
            {
                builder.UserID = _settings.SqlUsername.Trim();
                builder.Password = _secrets.SqlPassword;
            }
            return builder.ConnectionString;
        }

        public string DescribeSqlTarget() =>
            $"{BuildSqlServerPart()} / {_settings.SqlDatabase.Trim()}";

        private string BuildSqlServerPart()
        {
            var host = _settings.SqlHost.Trim();
            if (string.IsNullOrWhiteSpace(host)) host = "localhost";

            // Preserve an explicitly entered named instance or host,port endpoint.
            // A named instance uses SQL Browser unless auto-detection found its TCP port.
            if (host.Contains('\\') || host.Contains(',')) return host;
            return _settings.SqlPort > 0 ? $"{host},{_settings.SqlPort}" : host;
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

            return TryDetectLocalSqlInstance();
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

        private static JtlDbDetectionResult? TryDetectLocalSqlInstance()
        {
            var instances = new List<LocalSqlInstance>();
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
                    using var namesKey = baseKey.OpenSubKey(
                        @"SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL");
                    if (namesKey == null) continue;

                    foreach (var instanceName in namesKey.GetValueNames())
                    {
                        var instanceId = namesKey.GetValue(instanceName)?.ToString();
                        if (string.IsNullOrWhiteSpace(instanceId)) continue;
                        instances.Add(new LocalSqlInstance(
                            instanceName,
                            ReadSqlTcpPort(baseKey, instanceId)));
                    }
                }
                catch
                {
                }
            }

            var selected = instances
                .GroupBy(instance => instance.Name, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.OrderByDescending(instance => instance.Port.HasValue).First())
                .OrderBy(instance => SqlInstancePriority(instance.Name))
                .ThenBy(instance => instance.Name, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
            if (selected == null) return null;

            var isDefault = string.Equals(
                selected.Name,
                "MSSQLSERVER",
                StringComparison.OrdinalIgnoreCase);
            var host = selected.Port.HasValue || isDefault
                ? "localhost"
                : $@"localhost\{selected.Name}";
            var port = selected.Port ?? (isDefault ? 1433 : 0);
            var endpoint = selected.Port.HasValue
                ? $"TCP {selected.Port.Value}"
                : isDefault
                    ? "default TCP"
                    : "named instance";

            return new JtlDbDetectionResult
            {
                Host = host,
                Port = port,
                Database = "eazybusiness",
                PreserveCredentials = true,
                RequiresConnectionTest = true,
                Source = $"Local SQL instance {selected.Name} ({endpoint})",
            };
        }

        private static int? ReadSqlTcpPort(RegistryKey baseKey, string instanceId)
        {
            try
            {
                using var tcpKey = baseKey.OpenSubKey(
                    $@"SOFTWARE\Microsoft\Microsoft SQL Server\{instanceId}\MSSQLServer\SuperSocketNetLib\Tcp\IPAll");
                if (tcpKey == null) return null;
                foreach (var valueName in new[] { "TcpPort", "TcpDynamicPorts" })
                {
                    var value = tcpKey.GetValue(valueName)?.ToString()?.Trim();
                    if (int.TryParse(value, out var port) && port is > 0 and <= 65535)
                        return port;
                }
            }
            catch
            {
            }
            return null;
        }

        private static int SqlInstancePriority(string name)
        {
            if (string.Equals(name, "JTLWAWI", StringComparison.OrdinalIgnoreCase)) return 0;
            if (name.Contains("JTL", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("WAWI", StringComparison.OrdinalIgnoreCase)) return 1;
            if (string.Equals(name, "MSSQLSERVER", StringComparison.OrdinalIgnoreCase)) return 2;
            return 3;
        }

        private sealed record LocalSqlInstance(string Name, int? Port);
    }

    public class JtlDbDetectionResult
    {
        public string Host { get; set; } = "localhost";
        public int Port { get; set; } = 1433;
        public string Database { get; set; } = "eazybusiness";
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
        public bool WindowsAuth { get; set; }
        public bool PreserveCredentials { get; set; }
        public bool RequiresConnectionTest { get; set; }
        public string Source { get; set; } = "";
    }
}
