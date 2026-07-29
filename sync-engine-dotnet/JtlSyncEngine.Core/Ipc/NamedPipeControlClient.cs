using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace JtlSyncEngine.Ipc
{
    public sealed class NamedPipeControlClient
    {
        public async Task<ServiceControlResponse> SendAsync(
            ServiceControlRequest request,
            TimeSpan? timeout = null,
            CancellationToken cancellationToken = default)
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(timeout ?? TimeSpan.FromSeconds(5));

            using var pipe = new NamedPipeClientStream(
                ".",
                ServiceControlProtocol.PipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);
            await pipe.ConnectAsync(timeoutCts.Token);

            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true,
            };
            using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);

            await writer.WriteLineAsync(JsonConvert.SerializeObject(request));
            var responseJson = await reader.ReadLineAsync(timeoutCts.Token);
            if (string.IsNullOrWhiteSpace(responseJson))
                throw new IOException("The sync service returned an empty response.");

            return JsonConvert.DeserializeObject<ServiceControlResponse>(responseJson)
                ?? throw new IOException("The sync service returned an invalid response.");
        }
    }
}
