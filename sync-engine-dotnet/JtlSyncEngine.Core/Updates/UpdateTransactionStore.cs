using System.Security.Cryptography;
using System.Text;
using JtlSyncEngine.Runtime;
using Newtonsoft.Json;

namespace JtlSyncEngine.Updates
{
    public sealed class UpdateTransactionStore
    {
        private static string IntegrityKeyPath =>
            Path.Combine(RuntimePaths.CurrentRoot,"secrets","update-integrity.key");

        public void Save(UpdateTransaction transaction)
        {
            RuntimePaths.EnsureCurrentLayout();
            transaction.UpdatedAt = DateTime.UtcNow;
            var payload = JsonConvert.SerializeObject(transaction,Formatting.None);
            var envelope = new TransactionEnvelope
            {
                Payload = payload,
                Mac = Convert.ToBase64String(HMACSHA256.HashData(GetIntegrityKey(),Encoding.UTF8.GetBytes(payload))),
            };
            var path = PathFor(transaction.TransactionId);
            var temp = $"{path}.tmp";
            File.WriteAllText(temp,JsonConvert.SerializeObject(envelope,Formatting.None));
            File.Move(temp,path,true);
        }

        public UpdateTransaction Load(string transactionId)
        {
            var envelope = JsonConvert.DeserializeObject<TransactionEnvelope>(File.ReadAllText(PathFor(transactionId)))
                ?? throw new InvalidDataException("Update transaction envelope is invalid.");
            var expected = HMACSHA256.HashData(GetIntegrityKey(),Encoding.UTF8.GetBytes(envelope.Payload));
            var actual = Convert.FromBase64String(envelope.Mac);
            if (actual.Length != expected.Length || !CryptographicOperations.FixedTimeEquals(actual,expected))
                throw new CryptographicException("Update transaction integrity verification failed.");
            return JsonConvert.DeserializeObject<UpdateTransaction>(envelope.Payload)
                ?? throw new InvalidDataException("Update transaction is invalid.");
        }

        public bool TryLoad(string transactionId,out UpdateTransaction? transaction)
        {
            try
            {
                transaction = Load(transactionId);
                return true;
            }
            catch
            {
                transaction = null;
                return false;
            }
        }

        public IEnumerable<UpdateTransaction> Pending()
        {
            RuntimePaths.EnsureCurrentLayout();
            foreach (var file in Directory.EnumerateFiles(RuntimePaths.UpdateTransactions,"*.json"))
            {
                UpdateTransaction? transaction = null;
                try { transaction = Load(Path.GetFileNameWithoutExtension(file)); } catch { }
                if (transaction != null &&
                    transaction.State is "restarting" or "service_stopped" or
                        "files_replaced" or "verifying_health" or
                        "rollback_started" or "rolled_back" or "rollback_failed")
                    yield return transaction;
            }
        }

        private static string PathFor(string transactionId)
        {
            if (!Guid.TryParse(transactionId,out _))
                throw new InvalidDataException("Update transaction ID is invalid.");
            return UpdateStagingService.TrustedChild(RuntimePaths.UpdateTransactions,$"{transactionId}.json");
        }

        private static byte[] GetIntegrityKey()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(IntegrityKeyPath)!);
            if (File.Exists(IntegrityKeyPath))
                return ProtectedData.Unprotect(File.ReadAllBytes(IntegrityKeyPath),null,DataProtectionScope.LocalMachine);
            var key = RandomNumberGenerator.GetBytes(32);
            var protectedKey = ProtectedData.Protect(key,null,DataProtectionScope.LocalMachine);
            var temp = $"{IntegrityKeyPath}.tmp";
            File.WriteAllBytes(temp,protectedKey);
            try { File.Move(temp,IntegrityKeyPath,false); }
            catch (IOException) { File.Delete(temp); }
            return File.Exists(IntegrityKeyPath)
                ? ProtectedData.Unprotect(File.ReadAllBytes(IntegrityKeyPath),null,DataProtectionScope.LocalMachine)
                : key;
        }

        private sealed class TransactionEnvelope
        {
            public string Payload { get; set; } = "";
            public string Mac { get; set; } = "";
        }
    }
}
