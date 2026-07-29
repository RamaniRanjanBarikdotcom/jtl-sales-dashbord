using System.Text.Json;
using JtlSyncEngine.Runtime;

namespace JtlSyncEngine.Commands
{
    public sealed class CommandHistoryStore
    {
        private readonly string _path = Path.Combine(
            RuntimePaths.CurrentRoot,"state","completed-commands.json");
        private readonly object _gate = new();

        public bool TryGet(string commandId,out JsonElement result)
        {
            lock (_gate)
            {
                var records = Load();
                return records.TryGetValue(commandId,out result);
            }
        }

        public void Save(string commandId,object result)
        {
            lock (_gate)
            {
                var records = Load();
                records[commandId] = JsonSerializer.SerializeToElement(result);
                var trimmed = records.TakeLast(200).ToDictionary(pair => pair.Key,pair => pair.Value);
                var temp = $"{_path}.tmp";
                File.WriteAllText(temp,JsonSerializer.Serialize(trimmed));
                File.Move(temp,_path,true);
            }
        }

        private Dictionary<string,JsonElement> Load()
        {
            try
            {
                if (!File.Exists(_path)) return new();
                return JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(
                    File.ReadAllText(_path)) ?? new();
            }
            catch
            {
                return new();
            }
        }
    }
}
