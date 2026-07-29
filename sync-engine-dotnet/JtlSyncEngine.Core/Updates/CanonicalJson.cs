using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;

namespace JtlSyncEngine.Updates
{
    public static class CanonicalJson
    {
        public static string Serialize(object value)
        {
            var token = JToken.FromObject(value, JsonSerializer.Create(new JsonSerializerSettings
            {
                NullValueHandling = NullValueHandling.Include,
                ContractResolver = new CamelCasePropertyNamesContractResolver(),
            }));
            return Canonicalize(token).ToString(Formatting.None);
        }

        private static JToken Canonicalize(JToken token)
        {
            if (token is JObject obj)
            {
                var result = new JObject();
                foreach (var property in obj.Properties().OrderBy(property => property.Name, StringComparer.Ordinal))
                    result.Add(property.Name, Canonicalize(property.Value));
                return result;
            }
            if (token is JArray array)
                return new JArray(array.Select(Canonicalize));
            return token.DeepClone();
        }
    }
}
