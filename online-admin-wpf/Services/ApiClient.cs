using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OnlineLotto.Wpf.Services;

public sealed class ApiException(string message, int? status = null) : Exception(message)
{
    public int? Status { get; } = status;
}

public sealed class ApiClient : IDisposable
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    private readonly HttpClient _http;

    public ApiClient(string baseUrl)
    {
        _http = new HttpClient
        {
            BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/"),
            Timeout = TimeSpan.FromSeconds(25),
        };
    }

    public string BaseUrl => _http.BaseAddress!.ToString().TrimEnd('/');

    public void SetToken(string? token) =>
        _http.DefaultRequestHeaders.Authorization = token is null ? null : new AuthenticationHeaderValue("Bearer", token);

    public Task<T> GetAsync<T>(string path) => SendAsync<T>(HttpMethod.Get, path);
    public Task<T> PostAsync<T>(string path, object? body = null) => SendAsync<T>(HttpMethod.Post, path, body);
    public Task<T> PutAsync<T>(string path, object body) => SendAsync<T>(HttpMethod.Put, path, body);
    public Task<T> PatchAsync<T>(string path, object body) => SendAsync<T>(HttpMethod.Patch, path, body);
    public Task<T> DeleteAsync<T>(string path) => SendAsync<T>(HttpMethod.Delete, path);

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body = null)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: Json);
        HttpResponseMessage res;
        try { res = await _http.SendAsync(req); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new ApiException($"Server ({BaseUrl}) ကို ချိတ်ဆက်လို့ မရပါ");
        }
        using (res)
        {
            if (res.IsSuccessStatusCode)
                return (await res.Content.ReadFromJsonAsync<T>(Json))!;
            var err = await res.Content.ReadFromJsonAsync<ErrorBody>(Json);
            throw new ApiException(err?.Error ?? $"HTTP {(int)res.StatusCode}", (int)res.StatusCode);
        }
    }

    public void Dispose() => _http.Dispose();
}
