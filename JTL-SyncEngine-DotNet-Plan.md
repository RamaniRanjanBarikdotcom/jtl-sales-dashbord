# JTL Sync Engine — .NET Desktop Application Plan
**Version:** 1.0
**For:** Development team / Claude Code / Cursor

---

## WHY .NET IS THE BEST CHOICE FOR THIS PROJECT

Before comparing options, understand why .NET fits this specific use case better than anything else.

**JTL-Wawi runs on Windows. JTL's SQL Server runs on Windows. Your office server is Windows.**

.NET is Microsoft's own framework. It has the deepest, most native integration with:
- Windows OS (system tray, startup registry, notifications, file system)
- Microsoft SQL Server (SqlClient — the official MS SQL driver, built by the same company)
- Windows Installer (ClickOnce, MSIX, WiX — all first-class .NET tools)

You are connecting a Microsoft database (SQL Server) on a Microsoft OS (Windows) to a desktop app.
There is no more natural fit than .NET.

---

## .NET DESKTOP OPTIONS — WHICH ONE TO USE

.NET has multiple UI frameworks. Here is what matters for this project:

| Framework | What it is | Verdict |
|---|---|---|
| **WPF** | Windows Presentation Foundation — XAML-based, vector UI, very mature | ✓ Best for complex UI |
| **WinForms** | Older Windows Forms — drag-drop designer, simpler | ✓ Fastest to build |
| **MAUI** | Cross-platform (Windows, Mac, Android, iOS) | ✗ Overkill, cross-platform not needed |
| **Blazor Desktop** | Web UI (HTML/CSS) inside a .NET app | ✓ Good if team knows web |
| **Avalonia** | Cross-platform, XAML-based, open source | ✓ Good if Mac/Linux needed |

### Recommendation: WPF + .NET 8

**Why WPF:**
- Native Windows look and feel — feels like professional enterprise software
- XAML UI is expressive and clean — not drag-drop like WinForms
- Excellent data binding — sync status table updates automatically
- Best system tray support of all .NET options
- Runs only on Windows — which is exactly where JTL runs
- Massive ecosystem of examples for enterprise line-of-business apps
- .NET 8 is LTS (Long Term Support) — supported until 2026

**Installer size:** ~15–25MB (self-contained) or ~5MB (framework-dependent)
**RAM at idle:** ~30–50MB
**Startup time:** ~0.5–1 second
**MS SQL driver:** Microsoft.Data.SqlClient — official, fastest, most reliable

---

## FULL TECH STACK

```
UI Framework:        WPF (.NET 8)
Language:            C#
MS SQL:              Microsoft.Data.SqlClient (official Microsoft driver)
HTTP client:         System.Net.Http.HttpClient (built into .NET)
Scheduler:           Quartz.NET (industry-standard .NET job scheduler)
System tray:         Hardcodet.NotifyIcon.Wpf (most popular WPF tray library)
Config/secrets:      Microsoft.Extensions.Configuration + DPAPI (Windows Data Protection)
Logging:             Serilog (most popular .NET logger — file + UI sink)
JSON:                System.Text.Json (built into .NET)
DI container:        Microsoft.Extensions.DependencyInjection (built into .NET)
Installer:           WiX Toolset v4 → .msi installer
                     OR MSIX packaging (modern Windows app store format)
Auto-update:         Squirrel.Windows OR WinSparkle for .NET
```

---

## FULL SYSTEM DIAGRAM

```
┌──────────────────────────────────────────────────────────────────┐
│  JTL Sync Engine (.NET 8 WPF App)                                │
│  Installed at: C:\Program Files\JTL Sync Engine\                 │
│  Config at:    C:\Users\{user}\AppData\Roaming\JTL-Sync\        │
│                                                                   │
│  ┌─────────────────┐   ┌────────────────────────────────────┐   │
│  │  WPF UI Layer   │   │  Application Core (C#)             │   │
│  │                 │   │                                    │   │
│  │  MainWindow     │◄──►  SyncOrchestrator                 │   │
│  │  DashboardView  │   │  QuartzScheduler                  │   │
│  │  SettingsView   │   │  ActivityChecker                  │   │
│  │  LogsView       │   │  ConfigService                    │   │
│  │  TrayIcon       │   │  LogService                       │   │
│  └─────────────────┘   └────────────┬───────────────────────┘   │
│                                      │                            │
│                    ┌─────────────────┼─────────────────┐         │
│                    ▼                 ▼                 ▼         │
│          ┌──────────────┐  ┌──────────────┐  ┌─────────────┐   │
│          │ MssqlService  │  │  ApiClient   │  │ WatermarkSvc│   │
│          │               │  │              │  │             │   │
│          │ SqlClient     │  │ HttpClient   │  │ JSON files  │   │
│          │ connects to   │  │ POSTs to     │  │ AppData     │   │
│          │ JTL MS SQL    │  │ backend API  │  │ folder      │   │
│          └──────────────┘  └──────────────┘  └─────────────┘   │
└──────────────────────────────────────────────────────────────────┘
         │                          │
         │ SQL queries               │ HTTPS POST
         │ (local LAN)               │ /api/sync/ingest
         ▼                          ▼
   JTL MS SQL Server          Backend API Server
   (eazybusiness DB)           (NestJS + PostgreSQL)
```

---

## FOLDER STRUCTURE

```
JtlSyncEngine/
│
├── JtlSyncEngine.sln                         Solution file
│
├── JtlSyncEngine/                            Main project
│   ├── JtlSyncEngine.csproj
│   ├── App.xaml                              Application entry point
│   ├── App.xaml.cs                           Startup logic, DI setup, tray init
│   │
│   ├── Views/                                WPF Windows and Pages
│   │   ├── MainWindow.xaml                   Shell window with navigation
│   │   ├── MainWindow.xaml.cs
│   │   ├── DashboardView.xaml                Sync status table + buttons
│   │   ├── DashboardView.xaml.cs
│   │   ├── SettingsView.xaml                 Connection + schedule settings
│   │   ├── SettingsView.xaml.cs
│   │   └── LogsView.xaml                     Scrollable log viewer
│   │       LogsView.xaml.cs
│   │
│   ├── ViewModels/                           MVVM ViewModels
│   │   ├── DashboardViewModel.cs             Sync status, next sync timers
│   │   ├── SettingsViewModel.cs              Form fields, test connection
│   │   └── LogsViewModel.cs                  Log entries, filter
│   │
│   ├── Models/                               Data models
│   │   ├── SyncStatus.cs                     Per-module sync state
│   │   ├── LogEntry.cs                       Log record
│   │   ├── AppSettings.cs                    All settings
│   │   ├── IngestBatch.cs                    Request body for POST
│   │   └── JtlModels/                        Raw JTL row models
│   │       ├── JtlOrder.cs
│   │       ├── JtlOrderItem.cs
│   │       ├── JtlProduct.cs
│   │       ├── JtlCustomer.cs
│   │       └── JtlInventory.cs
│   │
│   ├── Services/                             Business logic
│   │   ├── MssqlService.cs                   JTL MS SQL queries
│   │   ├── ApiClient.cs                      HTTP POST to backend
│   │   ├── SyncOrchestrator.cs               Runs a full sync for one module
│   │   ├── QuartzScheduler.cs                Cron job setup and management
│   │   ├── ActivityChecker.cs                Polls /api/health for idle sync
│   │   ├── WatermarkService.cs               Read/write watermark JSON files
│   │   ├── ConfigService.cs                  Load/save app settings
│   │   └── LogService.cs                     Serilog setup + UI log sink
│   │
│   ├── Jobs/                                 Quartz.NET job classes
│   │   ├── OrdersSyncJob.cs
│   │   ├── ProductsSyncJob.cs
│   │   ├── CustomersSyncJob.cs
│   │   ├── InventorySyncJob.cs
│   │   └── ActivityCheckJob.cs
│   │
│   ├── Resources/
│   │   ├── Icons/
│   │   │   ├── tray-ok.ico
│   │   │   ├── tray-warn.ico
│   │   │   ├── tray-error.ico
│   │   │   └── app.ico
│   │   └── Styles/
│   │       ├── Colors.xaml                   Color palette (matches dashboard)
│   │       ├── Buttons.xaml
│   │       └── Tables.xaml
│   │
│   ├── Converters/                           WPF value converters
│   │   ├── StatusToColorConverter.cs         ok→green, warn→amber, error→red
│   │   ├── StatusToIconConverter.cs
│   │   └── DateTimeToRelativeConverter.cs    "2 min ago"
│   │
│   └── Helpers/
│       ├── StartupHelper.cs                  Windows registry auto-start
│       ├── DpapiHelper.cs                    Encrypt/decrypt secrets
│       └── RelayCommand.cs                   ICommand implementation for MVVM
│
├── JtlSyncEngine.Installer/                 WiX installer project
│   ├── Package.wxs                           Main installer definition
│   ├── Shortcuts.wxs                         Start menu + desktop shortcuts
│   └── Prerequisites.wxs                     .NET runtime check
│
└── JtlSyncEngine.Tests/                     Unit tests
    ├── MssqlServiceTests.cs
    ├── SyncOrchestratorTests.cs
    └── WatermarkServiceTests.cs
```

---

## SECTION 1 — CSPROJ FILE

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <UseWPF>true</UseWPF>
    <ApplicationIcon>Resources\Icons\app.ico</ApplicationIcon>
    <AssemblyName>JtlSyncEngine</AssemblyName>
    <RootNamespace>JtlSyncEngine</RootNamespace>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <PublishSingleFile>true</PublishSingleFile>
    <SelfContained>true</SelfContained>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
  </PropertyGroup>

  <ItemGroup>
    <!-- MS SQL — official Microsoft driver -->
    <PackageReference Include="Microsoft.Data.SqlClient" Version="5.2.0" />

    <!-- Scheduling -->
    <PackageReference Include="Quartz" Version="3.8.0" />
    <PackageReference Include="Quartz.Extensions.Hosting" Version="3.8.0" />

    <!-- System tray -->
    <PackageReference Include="Hardcodet.NotifyIcon.Wpf" Version="1.1.0" />

    <!-- Logging -->
    <PackageReference Include="Serilog" Version="4.0.0" />
    <PackageReference Include="Serilog.Sinks.File" Version="6.0.0" />

    <!-- Config -->
    <PackageReference Include="Microsoft.Extensions.Configuration" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.Configuration.Json" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="8.0.0" />

    <!-- JSON -->
    <!-- System.Text.Json is built into .NET 8 — no package needed -->
  </ItemGroup>
</Project>
```

---

## SECTION 2 — APP SETTINGS MODEL

```csharp
// Models/AppSettings.cs
public class AppSettings
{
    // JTL MS SQL connection
    public string MssqlHost       { get; set; } = string.Empty;
    public int    MssqlPort       { get; set; } = 1433;
    public string MssqlDatabase   { get; set; } = "eazybusiness";
    public string MssqlUsername   { get; set; } = string.Empty;
    // Password stored separately in DPAPI — never in plain JSON

    // Backend API
    public string BackendApiUrl   { get; set; } = string.Empty;
    // ApiKey stored separately in DPAPI
    public string TenantId        { get; set; } = string.Empty;

    // Sync schedules (cron expressions)
    public string OrdersCron      { get; set; } = "0 */15 * * * ?";  // every 15 min
    public string InventoryCron   { get; set; } = "0 */30 * * * ?";  // every 30 min
    public string ProductsCron    { get; set; } = "0 5 * * * ?";     // every hr at :05
    public string CustomersCron   { get; set; } = "0 0 * * * ?";     // every hr at :00

    // Idle sync
    public int    IdleThresholdMinutes    { get; set; } = 30;
    public int    IdleCheckIntervalMinutes { get; set; } = 5;

    // Batch size
    public int    BatchSize       { get; set; } = 500;

    // App behaviour
    public bool   StartWithWindows    { get; set; } = true;
    public bool   StartMinimised      { get; set; } = true;
    public int    LogRetentionDays    { get; set; } = 30;
}
```

---

## SECTION 3 — CONFIG SERVICE (with DPAPI encryption)

DPAPI (Data Protection API) is built into Windows.
It encrypts data using the currently logged-in Windows user's credentials.
No key management needed — Windows handles it automatically.
Encrypted data can only be decrypted by the same Windows user on the same machine.
This is the correct way to store passwords in a Windows desktop app.

```csharp
// Services/ConfigService.cs
public class ConfigService
{
    private readonly string _configPath;
    private readonly string _secretsPath;

    public ConfigService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "JTL-Sync");
        Directory.CreateDirectory(dir);
        _configPath  = Path.Combine(dir, "settings.json");
        _secretsPath = Path.Combine(dir, "secrets.dat"); // DPAPI-encrypted binary
    }

    public AppSettings Load()
    {
        if (!File.Exists(_configPath))
            return new AppSettings();

        var json = File.ReadAllText(_configPath);
        return JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
    }

    public void Save(AppSettings settings)
    {
        var json = JsonSerializer.Serialize(settings,
            new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_configPath, json);
    }

    // DPAPI — encrypt with current Windows user key
    public void SaveSecrets(string mssqlPassword, string apiKey)
    {
        var data = JsonSerializer.SerializeToUtf8Bytes(new
        {
            MssqlPassword = mssqlPassword,
            ApiKey = apiKey
        });
        var encrypted = ProtectedData.Protect(data, null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_secretsPath, encrypted);
    }

    public (string mssqlPassword, string apiKey) LoadSecrets()
    {
        if (!File.Exists(_secretsPath))
            return (string.Empty, string.Empty);

        var encrypted = File.ReadAllBytes(_secretsPath);
        var decrypted = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
        var obj = JsonSerializer.Deserialize<JsonElement>(decrypted);
        return (
            obj.GetProperty("MssqlPassword").GetString() ?? string.Empty,
            obj.GetProperty("ApiKey").GetString() ?? string.Empty
        );
    }
}
```

---

## SECTION 4 — MS SQL SERVICE

Using `Microsoft.Data.SqlClient` — the official Microsoft SQL Server driver.
This is the same driver used by Entity Framework and SQL Server Management Studio.

```csharp
// Services/MssqlService.cs
public class MssqlService
{
    private readonly ConfigService _config;
    private string _connectionString = string.Empty;

    public void UpdateConnectionString()
    {
        var settings = _config.Load();
        var (password, _) = _config.LoadSecrets();

        _connectionString = new SqlConnectionStringBuilder
        {
            DataSource         = $"{settings.MssqlHost},{settings.MssqlPort}",
            InitialCatalog     = settings.MssqlDatabase,
            UserID             = settings.MssqlUsername,
            Password           = password,
            TrustServerCertificate = true,
            ConnectTimeout     = 15,
            CommandTimeout     = 30,
            Pooling            = true,
            MaxPoolSize        = 5,
        }.ConnectionString;
    }

    public async Task<ConnectionTestResult> TestConnectionAsync()
    {
        var sw = Stopwatch.StartNew();
        try
        {
            await using var conn = new SqlConnection(_connectionString);
            await conn.OpenAsync();
            await using var cmd = new SqlCommand("SELECT 1", conn);
            await cmd.ExecuteScalarAsync();
            return new ConnectionTestResult(true, string.Empty, (int)sw.ElapsedMilliseconds);
        }
        catch (SqlException ex)
        {
            return new ConnectionTestResult(false, ex.Message, 0);
        }
    }

    public async Task<List<T>> QueryAsync<T>(string sql, SqlParameter[] parameters,
        Func<SqlDataReader, T> mapper)
    {
        var results = new List<T>();
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync();
        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddRange(parameters);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            results.Add(mapper(reader));
        return results;
    }
}
```

---

## SECTION 5 — ALL JTL SQL QUERIES

```csharp
// Services/MssqlService.cs — query methods

public async Task<List<JtlOrder>> GetOrdersAsync(DateTime since, DateTime until)
{
    const string sql = @"
        SELECT b.kBestellung, b.cBestellNr, b.dErstellt, b.kKunde,
               b.fGesamtsumme, b.fVersandkostenNetto, b.cStatus, b.dGeaendert,
               p.cKurzbezeichnung AS channel_name
        FROM tBestellung b
        LEFT JOIN tPlattform p ON p.kPlattform = b.kPlattform
        WHERE b.dGeaendert >= @since
          AND b.dGeaendert < @until
        ORDER BY b.dGeaendert ASC
        OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY";

    return await QueryAsync(sql,
        [
            new SqlParameter("@since",     since),
            new SqlParameter("@until",     until),
            new SqlParameter("@offset",    0),
            new SqlParameter("@batchSize", 10000)
        ],
        r => new JtlOrder
        {
            KBestellung         = r.GetInt64(r.GetOrdinal("kBestellung")),
            CBestellNr          = r.GetString(r.GetOrdinal("cBestellNr")),
            DErstellt           = r.GetDateTime(r.GetOrdinal("dErstellt")),
            KKunde              = r.IsDBNull(r.GetOrdinal("kKunde")) ? null : r.GetInt64(r.GetOrdinal("kKunde")),
            FGesamtsumme        = r.GetDecimal(r.GetOrdinal("fGesamtsumme")),
            FVersandkostenNetto = r.GetDecimal(r.GetOrdinal("fVersandkostenNetto")),
            CStatus             = r.GetString(r.GetOrdinal("cStatus")),
            DGeaendert          = r.GetDateTime(r.GetOrdinal("dGeaendert")),
            ChannelName         = r.IsDBNull(r.GetOrdinal("channel_name")) ? null : r.GetString(r.GetOrdinal("channel_name")),
        });
}

public async Task<List<JtlOrderItem>> GetOrderItemsAsync(IEnumerable<long> orderIds)
{
    var idList = string.Join(",", orderIds);
    var sql = $@"
        SELECT p.kBestellPos, p.kBestellung, p.kArtikel, p.nAnzahl,
               p.fVKPreis, p.fVKPreisNetto, p.fEKPreis, p.nRabatt, p.cName
        FROM tBestellPos p
        WHERE p.kBestellung IN ({idList})";

    return await QueryAsync(sql, [], r => new JtlOrderItem
    {
        KBestellPos  = r.GetInt64(r.GetOrdinal("kBestellPos")),
        KBestellung  = r.GetInt64(r.GetOrdinal("kBestellung")),
        KArtikel     = r.IsDBNull(r.GetOrdinal("kArtikel")) ? null : r.GetInt64(r.GetOrdinal("kArtikel")),
        NAnzahl      = r.GetDecimal(r.GetOrdinal("nAnzahl")),
        FVKPreis     = r.GetDecimal(r.GetOrdinal("fVKPreis")),
        FVKPreisNetto = r.GetDecimal(r.GetOrdinal("fVKPreisNetto")),
        FEKPreis     = r.IsDBNull(r.GetOrdinal("fEKPreis")) ? null : r.GetDecimal(r.GetOrdinal("fEKPreis")),
        NRabatt      = r.GetDecimal(r.GetOrdinal("nRabatt")),
        CName        = r.GetString(r.GetOrdinal("cName")),
    });
}

public async Task<List<JtlProduct>> GetProductsAsync(DateTime since)
{
    const string sql = @"
        SELECT a.kArtikel, a.cArtNr, a.cName, a.fEKNetto,
               a.fVKNetto, a.fVKBrutto, a.fGewicht, a.cBarcode,
               a.dErstellt, a.dLetzteAktualisierung,
               k.kKategorie, k.cName AS category_name
        FROM tArtikel a
        LEFT JOIN tArtikelKategorie ak ON ak.kArtikel = a.kArtikel
        LEFT JOIN tKategorie k ON k.kKategorie = ak.kKategorie
        WHERE a.dLetzteAktualisierung >= @since
           OR a.dErstellt >= @since";

    return await QueryAsync(sql, [new SqlParameter("@since", since)],
        r => new JtlProduct { /* map all fields */ });
}

public async Task<List<JtlCustomer>> GetCustomersAsync(DateTime since)
{
    const string sql = @"
        SELECT k.kKunde, k.cMail, k.cVorname, k.cNachname, k.cFirma,
               r.cPLZ, r.cOrt, r.cLand, k.dErstellt, k.dLetzteAenderung
        FROM tKunde k
        LEFT JOIN tRechnungsadresse r ON r.kKunde = k.kKunde
        WHERE k.dLetzteAenderung >= @since";

    return await QueryAsync(sql, [new SqlParameter("@since", since)],
        r => new JtlCustomer { /* map all fields */ });
}

public async Task<List<JtlInventory>> GetInventoryAsync()
{
    const string sql = @"
        SELECT wb.kArtikel, wb.kWarenLager, w.cName AS warehouse_name,
               wb.fVerfuegbar, wb.fReserviert, wb.fGesamt, wb.fMindestbestand
        FROM tWarenLagerBestand wb
        JOIN tWarenLager w ON w.kWarenLager = wb.kWarenLager
        WHERE wb.fGesamt > 0 OR wb.fVerfuegbar > 0";

    return await QueryAsync(sql, [], r => new JtlInventory { /* map all fields */ });
}
```

---

## SECTION 6 — SYNC ORCHESTRATOR

```csharp
// Services/SyncOrchestrator.cs
public class SyncOrchestrator
{
    private readonly MssqlService   _mssql;
    private readonly ApiClient      _api;
    private readonly WatermarkService _watermark;
    private readonly LogService     _logger;
    private readonly AppSettings    _settings;

    // Thread-safe status dictionary — UI reads this
    private readonly ConcurrentDictionary<string, SyncStatus> _status = new();
    public IReadOnlyDictionary<string, SyncStatus> Status => _status;

    // Event that the UI subscribes to for live updates
    public event EventHandler<SyncStatus>? StatusChanged;

    public async Task RunOrdersSyncAsync(string triggerType = "scheduled")
    {
        await RunModuleSync("orders", triggerType, async (watermark) =>
        {
            var until   = DateTime.UtcNow.AddSeconds(-30);
            var orders  = await _mssql.GetOrdersAsync(watermark, until);

            // Also fetch order items for these orders
            var orderIds = orders.Select(o => o.KBestellung).Distinct().ToList();
            var items    = orderIds.Any()
                ? await _mssql.GetOrderItemsAsync(orderIds)
                : new List<JtlOrderItem>();

            // Combine into batches
            var batches = CreateBatches(orders, items);
            return (batches, until);
        });
    }

    public async Task RunInventorySyncAsync(string triggerType = "scheduled")
    {
        await RunModuleSync("inventory", triggerType, async (_) =>
        {
            var rows    = await _mssql.GetInventoryAsync();
            var batches = CreateBatches(rows);
            return (batches, DateTime.UtcNow);
        });
    }

    public async Task RunAllSyncAsync(string triggerType = "idle")
    {
        await RunOrdersSyncAsync(triggerType);
        await RunInventorySyncAsync(triggerType);
        await RunProductsSyncAsync(triggerType);
        await RunCustomersSyncAsync(triggerType);
    }

    private async Task RunModuleSync(string module, string triggerType,
        Func<DateTime, Task<(List<IngestBatch> batches, DateTime newWatermark)>> extract)
    {
        var status = new SyncStatus { Module = module, Status = "running", StartedAt = DateTime.UtcNow };
        UpdateStatus(module, status);

        try
        {
            var watermark = _watermark.Get(module);
            _logger.Info($"{module} sync started (trigger: {triggerType}, since: {watermark:u})");

            var (batches, newWatermark) = await extract(watermark);

            int totalRows = 0;
            for (int i = 0; i < batches.Count; i++)
            {
                batches[i].BatchIndex   = i;
                batches[i].TotalBatches = batches.Count;
                await _api.SendBatchAsync(batches[i]);
                totalRows += batches[i].Rows.Count;
                _logger.Info($"Batch {i+1}/{batches.Count} sent — {batches[i].Rows.Count} rows");
            }

            _watermark.Set(module, newWatermark);

            var duration = DateTime.UtcNow - status.StartedAt;
            status.Status      = "ok";
            status.RowsSynced  = totalRows;
            status.Duration    = duration;
            status.CompletedAt = DateTime.UtcNow;
            UpdateStatus(module, status);

            _logger.Info($"{module} sync complete — {totalRows} rows — {duration.TotalSeconds:F1}s");
        }
        catch (Exception ex)
        {
            status.Status       = "error";
            status.ErrorMessage = ex.Message;
            status.CompletedAt  = DateTime.UtcNow;
            UpdateStatus(module, status);
            _logger.Error($"{module} sync failed: {ex.Message}");
        }
    }

    private void UpdateStatus(string module, SyncStatus status)
    {
        _status[module] = status;
        StatusChanged?.Invoke(this, status);
    }
}
```

---

## SECTION 7 — API CLIENT

```csharp
// Services/ApiClient.cs
public class ApiClient
{
    private readonly HttpClient     _http;
    private readonly ConfigService  _config;
    private readonly LogService     _logger;

    public ApiClient(ConfigService config, LogService logger)
    {
        _config = config;
        _logger = logger;
        _http   = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
    }

    public void UpdateAuthHeader()
    {
        var (_, apiKey) = _config.LoadSecrets();
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", apiKey);
    }

    public async Task SendBatchAsync(IngestBatch batch)
    {
        const int maxRetries = 3;
        var delays = new[] { 5, 15, 45 }; // seconds

        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                var settings = _config.Load();
                var url      = $"{settings.BackendApiUrl.TrimEnd('/')}/api/sync/ingest";
                var json     = JsonSerializer.Serialize(batch);
                var content  = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await _http.PostAsync(url, content);
                response.EnsureSuccessStatusCode();
                return; // success
            }
            catch (Exception ex) when (attempt < maxRetries)
            {
                _logger.Warn($"Batch send failed (attempt {attempt+1}/{maxRetries}): {ex.Message}. Retrying in {delays[attempt]}s");
                await Task.Delay(TimeSpan.FromSeconds(delays[attempt]));
            }
        }

        throw new InvalidOperationException($"Batch failed after {maxRetries} retries");
    }

    public async Task<HealthResponse?> GetHealthAsync()
    {
        try
        {
            var settings = _config.Load();
            var url      = $"{settings.BackendApiUrl.TrimEnd('/')}/api/health";
            var response = await _http.GetStringAsync(url);
            return JsonSerializer.Deserialize<HealthResponse>(response);
        }
        catch
        {
            return null;
        }
    }
}
```

---

## SECTION 8 — QUARTZ SCHEDULER

Quartz.NET is the most powerful job scheduling library in .NET.
Used in large enterprise systems — far more capable than a simple cron.

```csharp
// Services/QuartzScheduler.cs
public class QuartzScheduler
{
    private IScheduler? _scheduler;
    private readonly IServiceProvider _services;
    private readonly AppSettings _settings;

    public async Task StartAsync()
    {
        var factory    = new StdSchedulerFactory();
        _scheduler     = await factory.GetScheduler();
        _scheduler.JobFactory = new MicrosoftDependencyInjectionJobFactory(_services);

        await ScheduleJob<OrdersSyncJob>(  "orders-sync",   _settings.OrdersCron);
        await ScheduleJob<InventorySyncJob>("inventory-sync",_settings.InventoryCron);
        await ScheduleJob<ProductsSyncJob>( "products-sync", _settings.ProductsCron);
        await ScheduleJob<CustomersSyncJob>("customers-sync",_settings.CustomersCron);
        await ScheduleJob<ActivityCheckJob>("activity-check",
            $"0 */{_settings.IdleCheckIntervalMinutes} * * * ?");

        await _scheduler.Start();
    }

    private async Task ScheduleJob<T>(string name, string cronExpression)
        where T : IJob
    {
        var job = JobBuilder.Create<T>()
            .WithIdentity(name)
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity($"{name}-trigger")
            .WithCronSchedule(cronExpression)
            .Build();

        await _scheduler!.ScheduleJob(job, trigger);
    }

    public async Task TriggerNowAsync(string module)
    {
        await _scheduler!.TriggerJob(new JobKey($"{module}-sync"));
    }

    public async Task PauseAllAsync()  => await _scheduler!.PauseAll();
    public async Task ResumeAllAsync() => await _scheduler!.ResumeAll();
    public async Task StopAsync()      => await _scheduler!.Shutdown(waitForJobsToComplete: true);
}

// Jobs/OrdersSyncJob.cs
public class OrdersSyncJob : IJob
{
    private readonly SyncOrchestrator _orchestrator;
    public OrdersSyncJob(SyncOrchestrator orchestrator) => _orchestrator = orchestrator;
    public async Task Execute(IJobExecutionContext context) =>
        await _orchestrator.RunOrdersSyncAsync("scheduled");
}
```

---

## SECTION 9 — WPF DASHBOARD VIEW

```xml
<!-- Views/DashboardView.xaml -->
<UserControl x:Class="JtlSyncEngine.Views.DashboardView"
             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <Grid Margin="20">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>  <!-- status bar -->
            <RowDefinition Height="*"/>     <!-- sync table -->
            <RowDefinition Height="Auto"/>  <!-- buttons -->
            <RowDefinition Height="Auto"/>  <!-- idle bar -->
        </Grid.RowDefinitions>

        <!-- Status bar -->
        <StackPanel Grid.Row="0" Orientation="Horizontal" Margin="0,0,0,16">
            <Ellipse Width="10" Height="10" Fill="{Binding ConnectionColor}" Margin="0,0,8,0"/>
            <TextBlock Text="{Binding ConnectionStatus}" Foreground="#94a3b8"/>
            <TextBlock Text=" | " Foreground="#3d4f6b"/>
            <TextBlock Text="{Binding TenantName}" Foreground="#94a3b8"/>
            <TextBlock Text=" | Last sync: " Foreground="#3d4f6b"/>
            <TextBlock Text="{Binding LastSyncRelative}" Foreground="#94a3b8"/>
        </StackPanel>

        <!-- Sync status table -->
        <DataGrid Grid.Row="1" ItemsSource="{Binding SyncStatuses}"
                  AutoGenerateColumns="False" IsReadOnly="True"
                  Background="#080c1c" Foreground="#f0f4ff"
                  BorderBrush="#1e293b" GridLinesVisibility="Horizontal"
                  HorizontalGridLinesBrush="#1e293b" RowHeight="44">
            <DataGrid.Columns>
                <DataGridTextColumn  Header="Module"    Binding="{Binding ModuleDisplay}" Width="120"/>
                <DataGridTextColumn  Header="Last Sync" Binding="{Binding LastSyncRelative}" Width="130"/>
                <DataGridTemplateColumn Header="Status" Width="90">
                    <DataGridTemplateColumn.CellTemplate>
                        <DataTemplate>
                            <StackPanel Orientation="Horizontal">
                                <Ellipse Width="8" Height="8" Margin="0,0,6,0"
                                         Fill="{Binding StatusColor}"/>
                                <TextBlock Text="{Binding StatusText}"
                                           Foreground="{Binding StatusColor}"/>
                            </StackPanel>
                        </DataTemplate>
                    </DataGridTemplateColumn.CellTemplate>
                </DataGridTemplateColumn>
                <DataGridTextColumn  Header="Rows"      Binding="{Binding RowsDisplay}"    Width="100"/>
                <DataGridTextColumn  Header="Duration"  Binding="{Binding DurationDisplay}" Width="90"/>
                <DataGridTextColumn  Header="Next Sync" Binding="{Binding NextSyncRelative}" Width="120"/>
            </DataGrid.Columns>
        </DataGrid>

        <!-- Buttons -->
        <WrapPanel Grid.Row="2" Margin="0,16,0,16">
            <Button Content="▶ Sync Orders Now"    Command="{Binding SyncOrdersCommand}"
                    Margin="0,0,8,0" Padding="12,6"/>
            <Button Content="▶ Sync All"           Command="{Binding SyncAllCommand}"
                    Margin="0,0,8,0" Padding="12,6"/>
            <Button Content="{Binding PauseButtonText}" Command="{Binding TogglePauseCommand}"
                    Padding="12,6"/>
        </WrapPanel>

        <!-- Idle sync progress -->
        <StackPanel Grid.Row="3">
            <TextBlock Text="{Binding IdleStatusText}" Foreground="#3d4f6b" FontSize="11"/>
            <ProgressBar Value="{Binding IdleProgressPercent}" Maximum="100"
                         Height="4" Margin="0,4,0,0" Background="#1e293b"
                         Foreground="#60a5fa"/>
        </StackPanel>
    </Grid>
</UserControl>
```

---

## SECTION 10 — SYSTEM TRAY (App.xaml.cs)

```csharp
// App.xaml.cs
public partial class App : Application
{
    private TaskbarIcon? _trayIcon;
    private MainWindow?  _mainWindow;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Build DI container
        var services = new ServiceCollection();
        ConfigureServices(services);
        var provider = services.BuildServiceProvider();

        // Create tray icon
        _trayIcon = (TaskbarIcon)FindResource("TrayIcon");
        _trayIcon.DataContext = provider.GetRequiredService<TrayViewModel>();

        // Create main window but don't show it yet
        _mainWindow = provider.GetRequiredService<MainWindow>();

        // Start scheduler
        var scheduler = provider.GetRequiredService<QuartzScheduler>();
        _ = scheduler.StartAsync();

        // Auto-start: if not minimised setting, show window
        var config = provider.GetRequiredService<ConfigService>().Load();
        if (!config.StartMinimised)
            _mainWindow.Show();
    }

    // Called from tray icon click or "Open Dashboard" menu item
    public void ShowMainWindow()
    {
        if (_mainWindow!.IsVisible)
        {
            _mainWindow.Activate();
        }
        else
        {
            _mainWindow.Show();
            _mainWindow.WindowState = WindowState.Normal;
        }
    }

    // Clicking X minimises to tray instead of closing
    // Set in MainWindow: Closing event → e.Cancel = true; Hide();
}
```

```xml
<!-- App.xaml — tray icon definition -->
<Application.Resources>
    <tb:TaskbarIcon x:Key="TrayIcon"
                    IconSource="/Resources/Icons/tray-ok.ico"
                    ToolTipText="JTL Sync Engine"
                    LeftClickCommand="{Binding OpenWindowCommand}">
        <tb:TaskbarIcon.ContextMenu>
            <ContextMenu>
                <MenuItem Header="Open Dashboard"
                          Command="{Binding OpenWindowCommand}"/>
                <Separator/>
                <MenuItem Header="Sync Now">
                    <MenuItem Header="Orders"   Command="{Binding SyncOrdersCommand}"/>
                    <MenuItem Header="Inventory" Command="{Binding SyncInventoryCommand}"/>
                    <MenuItem Header="Products"  Command="{Binding SyncProductsCommand}"/>
                    <MenuItem Header="All"       Command="{Binding SyncAllCommand}"/>
                </MenuItem>
                <Separator/>
                <MenuItem Header="Settings"  Command="{Binding OpenSettingsCommand}"/>
                <MenuItem Header="Logs"      Command="{Binding OpenLogsCommand}"/>
                <Separator/>
                <MenuItem Header="Quit"      Command="{Binding QuitCommand}"/>
            </ContextMenu>
        </tb:TaskbarIcon.ContextMenu>
    </tb:TaskbarIcon>
</Application.Resources>
```

---

## SECTION 11 — WINDOWS AUTO-START

```csharp
// Helpers/StartupHelper.cs
public static class StartupHelper
{
    private const string AppName = "JTL-Sync-Engine";
    private const string RegKey  =
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";

    public static bool IsStartupEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegKey);
        return key?.GetValue(AppName) != null;
    }

    public static void Enable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegKey, writable: true)!;
        key.SetValue(AppName, $"\"{Environment.ProcessPath}\"");
    }

    public static void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegKey, writable: true)!;
        key.DeleteValue(AppName, throwOnMissingValue: false);
    }
}
```

---

## SECTION 12 — WATERMARK SERVICE

```csharp
// Services/WatermarkService.cs
public class WatermarkService
{
    private readonly string _dir;

    public WatermarkService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        _dir = Path.Combine(appData, "JTL-Sync", "watermarks");
        Directory.CreateDirectory(_dir);
    }

    public DateTime Get(string module)
    {
        var file = Path.Combine(_dir, $"{module}.json");
        if (!File.Exists(file)) return DateTime.UtcNow.AddYears(-5); // first run = full history

        var json = File.ReadAllText(file);
        var obj  = JsonSerializer.Deserialize<JsonElement>(json);
        return obj.GetProperty("lastSyncTime").GetDateTime();
    }

    public void Set(string module, DateTime time)
    {
        var file = Path.Combine(_dir, $"{module}.json");
        var json = JsonSerializer.Serialize(new { lastSyncTime = time },
            new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(file, json);
    }
}
```

---

## SECTION 13 — LOGGING WITH SERILOG + UI SINK

```csharp
// Services/LogService.cs
public class LogService
{
    public event EventHandler<LogEntry>? LogAdded;

    public LogService(AppSettings settings)
    {
        var appData  = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var logDir   = Path.Combine(appData, "JTL-Sync", "logs");

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Information()
            .WriteTo.File(
                path: Path.Combine(logDir, "sync-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: settings.LogRetentionDays,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss}  {Level:u5}  {Message}{NewLine}")
            .WriteTo.Sink(new UiLogSink(entry => LogAdded?.Invoke(this, entry)))
            .CreateLogger();
    }

    public void Info(string msg)  => Log.Information(msg);
    public void Warn(string msg)  => Log.Warning(msg);
    public void Error(string msg) => Log.Error(msg);
}

// Custom Serilog sink that fires events to the UI
public class UiLogSink : ILogEventSink
{
    private readonly Action<LogEntry> _onLog;
    public UiLogSink(Action<LogEntry> onLog) => _onLog = onLog;

    public void Emit(LogEvent logEvent)
    {
        _onLog(new LogEntry
        {
            Timestamp = logEvent.Timestamp.LocalDateTime,
            Level     = logEvent.Level.ToString(),
            Message   = logEvent.RenderMessage(),
        });
    }
}
```

---

## SECTION 14 — INSTALLER (WiX v4)

```xml
<!-- JtlSyncEngine.Installer/Package.wxs -->
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="JTL Sync Engine"
           Manufacturer="Your Company"
           Version="1.0.0"
           UpgradeCode="PUT-A-GUID-HERE">

    <MajorUpgrade DowngradeErrorMessage="A newer version is already installed." />

    <MediaTemplate EmbedCab="yes" />

    <Feature Id="Main" Title="JTL Sync Engine" Level="1">
      <ComponentGroupRef Id="AppComponents" />
    </Feature>

    <!-- Install files -->
    <ComponentGroup Id="AppComponents" Directory="INSTALLFOLDER">
      <Component Id="MainExecutable">
        <File Source="$(var.JtlSyncEngine.TargetPath)" KeyPath="yes">
          <Shortcut Id="StartMenuShortcut"
                    Directory="ProgramMenuFolder"
                    Name="JTL Sync Engine"
                    Advertise="yes"
                    Icon="AppIcon.ico"/>
        </File>
      </Component>
    </ComponentGroup>

    <!-- Install directory -->
    <StandardDirectory Id="ProgramFilesFolder">
      <Directory Id="INSTALLFOLDER" Name="JTL Sync Engine"/>
    </StandardDirectory>

    <!-- Uninstall shortcut -->
    <UI>
      <UIRef Id="WixUI_InstallDir" />
    </UI>

  </Package>
</Wix>
```

Build installer:
```
dotnet build -c Release
dotnet tool install --global wix
wix build JtlSyncEngine.Installer/Package.wxs -o JtlSyncEngine-Setup.msi
```

---

## SECTION 15 — .NET vs OTHER OPTIONS — FINAL COMPARISON

| | **.NET 8 WPF** | Tauri + React | Python + PyQt6 |
|---|---|---|---|
| **Installer size** | ~20–25MB | ~15MB | ~50MB |
| **RAM at idle** | ~35–50MB | ~25MB | ~60MB |
| **Startup time** | ~0.5s | <0.5s | ~1.5s |
| **MS SQL driver** | SqlClient (official Microsoft) | tiberius (Rust) | pyodbc (best) |
| **UI quality** | Native WPF — professional | React — modern | Qt — professional |
| **Windows integration** | Best (native) | Good | Good |
| **DPAPI secrets** | Native (built-in) | Via OS keychain | Via keyring |
| **Auto-start** | Registry (native) | Tauri plugin | Registry |
| **Build complexity** | Low–Medium | Medium | Low |
| **Language** | C# | Rust + React/TS | Python |
| **Learning curve** | Easy if any OOP | Steep (Rust) | Easy |
| **Auto-update** | Squirrel.Windows | Built-in Tauri | Manual |
| **Long-term support** | Microsoft — excellent | Good | Good |

### Why .NET wins for this specific project

1. **Microsoft.Data.SqlClient** is literally made by the same team that made SQL Server. Best performance, best compatibility, official support forever.

2. **DPAPI** — Windows credential storage built into .NET. One line of code. No third-party library, no configuration. Passwords are protected by Windows user login credentials automatically.

3. **WPF** has been the standard for enterprise Windows desktop apps for 15 years. Every enterprise software company (SAP, Oracle, etc.) ships WPF apps. Looks and behaves exactly like "real" software.

4. **C# is easy.** If your team knows TypeScript or Java, C# is immediately familiar. Much easier than Rust.

5. **The JTL-Wawi ecosystem is entirely .NET/Windows.** JTL themselves build their software in .NET. Your team will find resources, examples, and community knowledge immediately.

---

## SECTION 16 — BUILD ORDER

```
Step  1   Install: .NET 8 SDK, Visual Studio 2022 (Community is free)
Step  2   Create solution: dotnet new wpf -n JtlSyncEngine
Step  3   Add all NuGet packages (from Section 1 csproj)
Step  4   Models/AppSettings.cs + all JtlModels
Step  5   Models/SyncStatus.cs, LogEntry.cs, IngestBatch.cs
Step  6   Services/ConfigService.cs — JSON settings + DPAPI secrets
Step  7   Helpers/StartupHelper.cs — Windows registry
Step  8   Services/WatermarkService.cs — JSON watermark files
Step  9   Services/LogService.cs — Serilog + UiLogSink
Step 10   Services/MssqlService.cs — SqlClient pool + all 4 queries
Step 11   Services/ApiClient.cs — HttpClient + retry
Step 12   Services/SyncOrchestrator.cs — full sync run per module
Step 13   Jobs/ — all 5 Quartz job classes
Step 14   Services/QuartzScheduler.cs — all cron jobs
Step 15   Services/ActivityChecker.cs — idle detection
Step 16   Helpers/RelayCommand.cs — ICommand for MVVM
Step 17   Converters/ — status colour, datetime relative
Step 18   ViewModels/DashboardViewModel.cs
Step 19   ViewModels/SettingsViewModel.cs
Step 20   ViewModels/LogsViewModel.cs
Step 21   Resources/Styles/ — colours, button styles matching dashboard theme
Step 22   Views/DashboardView.xaml + .cs
Step 23   Views/SettingsView.xaml + .cs (connection test button)
Step 24   Views/LogsView.xaml + .cs
Step 25   Views/MainWindow.xaml + .cs (tab navigation, close→minimise)
Step 26   App.xaml — tray icon definition
Step 27   App.xaml.cs — DI container, scheduler start, tray setup
Step 28   Run in Debug mode: dotnet run
Step 29   Test connection to real JTL MS SQL
Step 30   Test one manual sync → verify backend receives it
Step 31   Test idle detection
Step 32   Test auto-start on Windows boot
Step 33   Publish: dotnet publish -c Release -r win-x64 --self-contained
Step 34   Build MSI: wix build (Section 14)
Step 35   Test installer on a clean Windows machine
```

---

*End of JTL Sync Engine — .NET Desktop Application Plan v1.0*
*Recommendation: .NET 8 WPF — best MS SQL integration, native Windows, professional UI.*
