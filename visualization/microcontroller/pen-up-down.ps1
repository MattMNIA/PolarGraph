$url = "http://192.168.50.5/api/path"

$body = @'
{
  "reset": true,
  "speed": 1800,
  "startPosition": { "x": 220, "y": 220 },
  "points": [
    { "x": 220, "y": 220, "penDown": true },
    { "x": 220, "y": 220, "penDown": false },
    { "x": 220, "y": 220, "penDown": true },
    { "x": 220, "y": 220, "penDown": false },
    { "x": 220, "y": 220, "penDown": true },
    { "x": 220, "y": 220, "penDown": false },
    { "x": 220, "y": 220, "penDown": true },
    { "x": 220, "y": 220, "penDown": false },
    { "x": 220, "y": 220, "penDown": true },
    { "x": 220, "y": 220, "penDown": false },
    { "x": 220, "y": 220, "penDown": true },
    { "x": 220, "y": 220, "penDown": false },
    { "x": 220, "y": 220, "penDown": true }
  ]
}
'@

Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json' -Body $body