using System;
using System.IO;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace JtlSyncEngine.Ipc
{
    public sealed class NamedPipeControlServer : IAsyncDisposable
    {
        private readonly Func<ServiceControlRequest, CancellationToken, Task<ServiceControlResponse>> _handler;
        private readonly CancellationTokenSource _shutdown = new();
        private Task? _listener;

        public NamedPipeControlServer(
            Func<ServiceControlRequest, CancellationToken, Task<ServiceControlResponse>> handler)
        {
            _handler = handler;
        }

        public void Start(CancellationToken cancellationToken = default)
        {
            if (_listener != null) return;
            var linked = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken,
                _shutdown.Token);
            _listener = ListenAsync(linked.Token);
        }

        private async Task ListenAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await using var pipe = new NamedPipeServerStream(
                    ServiceControlProtocol.PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await pipe.WaitForConnectionAsync(cancellationToken);
                await HandleClientAsync(pipe, cancellationToken);
            }
        }

        private async Task HandleClientAsync(
            NamedPipeServerStream pipe,
            CancellationToken cancellationToken)
        {
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true,
            };
            using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);

            ServiceControlResponse response;
            try
            {
                if (!IsAuthorizedClient(pipe))
                    throw new UnauthorizedAccessException("Named-pipe access denied.");

                var requestJson = await reader.ReadLineAsync(cancellationToken);
                var request = JsonConvert.DeserializeObject<ServiceControlRequest>(
                    requestJson ?? "");
                if (request == null ||
                    request.ProtocolVersion != ServiceControlProtocol.ProtocolVersion)
                    throw new InvalidDataException("Unsupported control protocol.");

                response = await _handler(request, cancellationToken);
                response.RequestId = request.RequestId;
            }
            catch (Exception exception)
            {
                response = new ServiceControlResponse
                {
                    Success = false,
                    Error = exception.Message,
                };
            }

            await writer.WriteLineAsync(JsonConvert.SerializeObject(response));
        }

        private static bool IsAuthorizedClient(NamedPipeServerStream pipe)
        {
            if (!OperatingSystem.IsWindows()) return false;

            var authorized = false;
            pipe.RunAsClient(() =>
            {
                using var identity = WindowsIdentity.GetCurrent(true);
                if (identity == null)
                {
                    authorized = false;
                    return;
                }
                var principal = new WindowsPrincipal(identity);
                var configured = (
                    Environment.GetEnvironmentVariable("JTL_SYNC_PIPE_IDENTITIES") ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

                authorized = IsIdentityAuthorized(
                    identity.Name,
                    principal.IsInRole(WindowsBuiltInRole.Administrator),
                    configured);
            });
            return authorized;
        }

        public static bool IsIdentityAuthorized(
            string identityName,
            bool isAdministrator,
            string[] configuredIdentities)
        {
            return isAdministrator ||
                   Array.Exists(
                       configuredIdentities,
                       candidate => string.Equals(
                           candidate,
                           identityName,
                           StringComparison.OrdinalIgnoreCase));
        }

        public async ValueTask DisposeAsync()
        {
            _shutdown.Cancel();
            if (_listener != null)
            {
                try { await _listener; }
                catch (OperationCanceledException) { }
            }
            _shutdown.Dispose();
        }
    }
}
