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
        private readonly string? _serverIdentity =
            OperatingSystem.IsWindows() ? WindowsIdentity.GetCurrent()?.Name : null;
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

        private bool IsAuthorizedClient(NamedPipeServerStream pipe)
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
                    principal.IsInRole(WindowsBuiltInRole.Administrator) ||
                        IsAdministratorsGroupMember(DescribeGroups(identity)),
                    configured,
                    _serverIdentity);
            });
            return authorized;
        }

        private static string[] DescribeGroups(WindowsIdentity identity)
        {
            if (identity.Groups == null) return Array.Empty<string>();
            var sids = new List<string>();
            foreach (var group in identity.Groups)
            {
                try
                {
                    sids.Add(group.Value);
                }
                catch
                {
                    // An unresolvable group must not deny an otherwise valid caller.
                }
            }
            return sids.ToArray();
        }

        /// <summary>
        /// True when the caller belongs to the local Administrators group, whether or
        /// not the process is elevated.
        /// </summary>
        /// <remarks>
        /// The management UI runs asInvoker so it can be started on servers where no
        /// one can answer a UAC prompt. UAC then hands it a filtered token, and
        /// <c>WindowsPrincipal.IsInRole(Administrator)</c> reports false even for an
        /// administrator — which would have locked the operator out of the service
        /// control pipe entirely, so the app could no longer save settings or trigger
        /// a sync once the service was installed.
        ///
        /// The group SID is still present in a filtered token (as deny-only), so
        /// membership remains a truthful check. This does not widen access to ordinary
        /// users: registering the service requires elevation once, and only
        /// administrators can do that.
        /// </remarks>
        public static bool IsAdministratorsGroupMember(string[] groupSids)
        {
            const string builtinAdministrators = "S-1-5-32-544";
            return Array.Exists(
                groupSids,
                sid => string.Equals(sid, builtinAdministrators, StringComparison.OrdinalIgnoreCase));
        }

        public static bool IsIdentityAuthorized(
            string identityName,
            bool isAdministrator,
            string[] configuredIdentities,
            string? trustedServiceIdentity = null)
        {
            return isAdministrator ||
                   (!string.IsNullOrWhiteSpace(trustedServiceIdentity) &&
                    string.Equals(identityName,trustedServiceIdentity,StringComparison.OrdinalIgnoreCase)) ||
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
