using System.Security.Cryptography;

namespace JtlSyncEngine.Updates
{
    public sealed class ReleasePackageVerifier
    {
        public async Task VerifyHashAsync(
            string packagePath,
            string expectedSha256,
            CancellationToken cancellationToken)
        {
            await using var stream = new FileStream(
                packagePath, FileMode.Open, FileAccess.Read, FileShare.Read,
                1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var actual = await SHA256.HashDataAsync(stream, cancellationToken);
            var expected = Convert.FromHexString(expectedSha256.Trim());
            if (expected.Length != actual.Length ||
                !CryptographicOperations.FixedTimeEquals(actual, expected))
                throw new CryptographicException("Update package SHA-256 does not match the signed manifest.");
        }
    }
}
