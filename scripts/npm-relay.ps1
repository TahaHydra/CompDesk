$ErrorActionPreference = 'Stop'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:8899/")
$listener.Start()
Write-Host "Relay listening on http://127.0.0.1:8899/  (Ctrl+C to stop)"

$handler = New-Object System.Net.Http.HttpClientHandler
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(120)

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
    } catch { break }

    $path = $context.Request.RawUrl
    if ($path.StartsWith('/prisma/all_commits/')) {
        $upstreamUrl = "https://binaries.prisma.sh$($path.Substring('/prisma'.Length))"
    } else {
        $upstreamUrl = "https://registry.npmjs.org$path"
    }
    Write-Host "-> $($context.Request.HttpMethod) $path"
    try {
        $method = New-Object System.Net.Http.HttpMethod($context.Request.HttpMethod)
        $reqMsg = New-Object System.Net.Http.HttpRequestMessage($method, $upstreamUrl)
        $accept = $context.Request.Headers['Accept']
        if ($accept) { [void]$reqMsg.Headers.TryAddWithoutValidation('Accept', $accept) }
        if ($context.Request.HasEntityBody) {
            $body = New-Object System.IO.MemoryStream
            $context.Request.InputStream.CopyTo($body)
            $reqMsg.Content = [System.Net.Http.ByteArrayContent]::new($body.ToArray())
            if ($context.Request.ContentType) {
                [void]$reqMsg.Content.Headers.TryAddWithoutValidation('Content-Type', $context.Request.ContentType)
            }
            $encoding = $context.Request.Headers['Content-Encoding']
            if ($encoding) { [void]$reqMsg.Content.Headers.TryAddWithoutValidation('Content-Encoding', $encoding) }
        }
        $resp = $client.SendAsync($reqMsg).GetAwaiter().GetResult()
        $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $context.Response.StatusCode = [int]$resp.StatusCode
        $ct = $resp.Content.Headers.ContentType
        if ($ct) { $context.Response.ContentType = $ct.ToString() }
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        Write-Host "   ERROR: $($_.Exception.Message)"
        $context.Response.StatusCode = 502
    } finally {
        $context.Response.OutputStream.Close()
    }
}
