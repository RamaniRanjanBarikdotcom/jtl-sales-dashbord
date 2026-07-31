using JtlSyncEngine.Service;

Environment.SetEnvironmentVariable("JTL_SYNC_RUNTIME_MODE", "service");
// Distinguishes the real service from the management UI, which also runs in service
// mode but has only read access to the machine-wide data folder.
Environment.SetEnvironmentVariable("JTL_SYNC_RUNTIME_HOST", "service");

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "JtlSyncEngine";
});
builder.Services.AddHostedService<SyncEngineWorker>();

await builder.Build().RunAsync();
