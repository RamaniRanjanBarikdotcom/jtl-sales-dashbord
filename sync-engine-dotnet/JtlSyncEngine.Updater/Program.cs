using System.Diagnostics;
using System.ServiceProcess;
using JtlSyncEngine.Runtime;
using JtlSyncEngine.Updates;

if (args.Length != 2 ||
    !string.Equals(args[0],"--transaction",StringComparison.Ordinal) ||
    !Guid.TryParse(args[1],out _))
{
    Console.Error.WriteLine("Usage: JtlSyncEngine.Updater.exe --transaction <signed-transaction-uuid>");
    return 2;
}

RuntimePaths.EnsureCurrentLayout();
var logDirectory = Path.Combine(RuntimePaths.CurrentRoot,"logs","updater");
Directory.CreateDirectory(logDirectory);
var logPath = Path.Combine(logDirectory,$"update-{args[1]}.log");
void Log(string message) =>
    File.AppendAllText(logPath,$"[{DateTime.UtcNow:O}] {message}{Environment.NewLine}");

var store = new UpdateTransactionStore();
var badReleases = new BadReleaseRegistry();
UpdateTransaction transaction;
try
{
    transaction = store.Load(args[1]);
    Validate(transaction,args[1]);
}
catch (Exception exception)
{
    Log($"Transaction validation failed: {exception}");
    return 3;
}

Process? portableProcess = null;
try
{
    Log($"Waiting for host process {transaction.ServiceProcessId} to stop.");
    WaitForProcessExit(transaction.ServiceProcessId,TimeSpan.FromSeconds(60));
    transaction.State = "service_stopped";
    store.Save(transaction);

    CopyTree(transaction.StagedPayloadDirectory,transaction.InstallDirectory);
    transaction.State = "files_replaced";
    store.Save(transaction);
    Log($"Installed target build {transaction.TargetVersion} ({transaction.TargetGitSha}).");

    if (transaction.HostMode == "portable")
        portableProcess = StartPortable(transaction);
    else
        StartService(transaction.ExpectedServiceName,TimeSpan.FromSeconds(45));
    transaction.State = "verifying_health";
    store.Save(transaction);
    Log("Sync Engine restarted; waiting for backend-authoritative health completion.");

    var deadline = DateTime.UtcNow.AddSeconds(Math.Clamp(transaction.HealthTimeoutSeconds,30,900));
    while (DateTime.UtcNow < deadline)
    {
        Thread.Sleep(TimeSpan.FromSeconds(2));
        var current = store.Load(transaction.TransactionId);
        if (current.State == "completed")
        {
            Log("Update health verification completed.");
            return 0;
        }
        if (current.State == "health_failed")
            throw new InvalidOperationException(current.ErrorMessage ?? "New build health verification failed.");
    }
    throw new System.TimeoutException("New Sync Engine build did not complete health verification before timeout.");
}
catch (Exception exception)
{
    Log($"Update failed; beginning rollback: {exception}");
    var rollbackSucceeded = false;
    try
    {
        if (transaction.HostMode == "portable")
            StopPortable(portableProcess);
        else
            StopService(transaction.ExpectedServiceName,TimeSpan.FromSeconds(45));
        RestoreReplacedFiles(
            transaction.BackupDirectory,
            transaction.StagedPayloadDirectory,
            transaction.InstallDirectory);
        if (transaction.HostMode == "portable")
            StartPortable(transaction);
        else
            StartService(transaction.ExpectedServiceName,TimeSpan.FromSeconds(45));
        rollbackSucceeded = true;
        transaction.State = "rolled_back";
        transaction.ErrorCode = "UPDATE_HEALTH_OR_REPLACEMENT_FAILED";
        transaction.ErrorMessage = exception.Message;
        store.Save(transaction);
        Log("Rollback completed and previous Sync Engine version restarted.");
    }
    catch (Exception rollbackException)
    {
        transaction.State = "rollback_failed";
        transaction.ErrorCode = "ROLLBACK_FAILED";
        transaction.ErrorMessage = rollbackException.Message;
        store.Save(transaction);
        Log($"Rollback failed: {rollbackException}");
    }
    badReleases.Record(
        transaction.AgentId,transaction.ReleaseId,transaction.TargetVersion,
        transaction.ErrorCode ?? "UPDATE_FAILED",rollbackSucceeded);
    return rollbackSucceeded ? 10 : 11;
}

static void Validate(UpdateTransaction transaction,string transactionId)
{
    if (transaction.TransactionId != transactionId)
        throw new InvalidDataException("Transaction ID mismatch.");
    if (transaction.HostMode is not ("service" or "portable"))
        throw new InvalidDataException("Unexpected update host mode.");
    if (transaction.ExpectedServiceName != "JtlSyncEngine")
        throw new InvalidDataException("Unexpected service identity.");
    var expectedExecutable = transaction.HostMode == "portable"
        ? "JtlSyncEngine.exe"
        : "JtlSyncEngine.Service.exe";
    if (transaction.ExpectedExecutableName != expectedExecutable)
        throw new InvalidDataException("Unexpected Sync Engine executable identity.");
    if (transaction.State != "restarting")
        throw new InvalidDataException($"Transaction state {transaction.State} cannot be installed.");
    TrustedDirectory(transaction.StagedPayloadDirectory,RuntimePaths.UpdateStaging);
    TrustedDirectory(transaction.BackupDirectory,RuntimePaths.UpdateBackups);
    var install = Path.GetFullPath(transaction.InstallDirectory);
    if (!Directory.Exists(install) ||
        string.Equals(install,Path.GetPathRoot(install),StringComparison.OrdinalIgnoreCase))
        throw new InvalidDataException("Install directory is not a trusted application folder.");
    if (transaction.HostMode == "service")
    {
        var programFiles = Path.GetFullPath(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles));
        if (!install.StartsWith(
                programFiles + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Service install directory is outside Program Files.");
    }
    else
    {
        var updatesRoot = Path.GetFullPath(RuntimePaths.UpdatesRoot) +
            Path.DirectorySeparatorChar;
        if (install.StartsWith(updatesRoot,StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Portable install directory cannot be update staging.");
    }
    foreach (var required in new[]
    {
        expectedExecutable,"JtlSyncEngine.Updater.exe","version.json",
    })
        if (!File.Exists(Path.Combine(transaction.StagedPayloadDirectory,required)))
            throw new InvalidDataException($"Staged payload is missing {required}.");
    if (!File.Exists(Path.Combine(transaction.BackupDirectory,expectedExecutable)))
        throw new InvalidDataException("Binary backup is incomplete.");
}

static void TrustedDirectory(string candidate,string root)
{
    var trustedRoot = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
    var full = Path.GetFullPath(candidate);
    if (!full.StartsWith(trustedRoot,StringComparison.OrdinalIgnoreCase) || !Directory.Exists(full))
        throw new InvalidDataException("Transaction directory is outside its trusted root.");
}

static void WaitForProcessExit(int processId,TimeSpan timeout)
{
    try
    {
        using var process = Process.GetProcessById(processId);
        if (!process.WaitForExit((int)timeout.TotalMilliseconds))
            throw new System.TimeoutException("Existing service did not stop at a safe boundary.");
    }
    catch (ArgumentException)
    {
    }
}

static void CopyTree(string source,string destination)
{
    Directory.CreateDirectory(destination);
    foreach (var directory in Directory.EnumerateDirectories(source,"*",SearchOption.AllDirectories))
        Directory.CreateDirectory(Path.Combine(destination,Path.GetRelativePath(source,directory)));
    foreach (var file in Directory.EnumerateFiles(source,"*",SearchOption.AllDirectories))
    {
        var target = Path.Combine(destination,Path.GetRelativePath(source,file));
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temp = $"{target}.update";
        File.Copy(file,temp,true);
        File.Move(temp,target,true);
    }
}

static void RestoreReplacedFiles(string backup,string stagedPayload,string installDirectory)
{
    foreach (var stagedFile in Directory.EnumerateFiles(
        stagedPayload,"*",SearchOption.AllDirectories))
    {
        var relative = Path.GetRelativePath(stagedPayload,stagedFile);
        var installedFile = Path.Combine(installDirectory,relative);
        var backupFile = Path.Combine(backup,relative);
        if (!File.Exists(backupFile))
        {
            File.Delete(installedFile);
            continue;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(installedFile)!);
        var temp = $"{installedFile}.rollback";
        File.Copy(backupFile,temp,true);
        File.Move(temp,installedFile,true);
    }
}

static Process StartPortable(UpdateTransaction transaction)
{
    var executable = Path.Combine(
        transaction.InstallDirectory,
        transaction.ExpectedExecutableName);
    var process = Process.Start(new ProcessStartInfo
    {
        FileName = executable,
        Arguments = "--updated --minimized",
        WorkingDirectory = transaction.InstallDirectory,
        UseShellExecute = true,
    });
    return process ?? throw new InvalidOperationException(
        "Portable Sync Engine could not be restarted.");
}

static void StopPortable(Process? process)
{
    if (process == null) return;
    try
    {
        if (process.HasExited) return;
        process.CloseMainWindow();
        if (!process.WaitForExit((int)TimeSpan.FromSeconds(20).TotalMilliseconds))
            process.Kill(true);
    }
    finally
    {
        process.Dispose();
    }
}

static void StopService(string serviceName,TimeSpan timeout)
{
    using var service = new ServiceController(serviceName);
    service.Refresh();
    if (service.Status == ServiceControllerStatus.Stopped) return;
    if (!service.CanStop) throw new InvalidOperationException("Service cannot be stopped safely.");
    service.Stop();
    service.WaitForStatus(ServiceControllerStatus.Stopped,timeout);
}

static void StartService(string serviceName,TimeSpan timeout)
{
    using var service = new ServiceController(serviceName);
    service.Refresh();
    if (service.Status == ServiceControllerStatus.Running) return;
    service.Start();
    service.WaitForStatus(ServiceControllerStatus.Running,timeout);
}
