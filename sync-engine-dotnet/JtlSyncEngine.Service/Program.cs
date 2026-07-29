using JtlSyncEngine.Service;

Environment.SetEnvironmentVariable("JTL_SYNC_RUNTIME_MODE", "service");

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "JtlSyncEngine";
});
builder.Services.AddHostedService<SyncEngineWorker>();

await builder.Build().RunAsync();
