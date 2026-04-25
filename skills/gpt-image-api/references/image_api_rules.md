# OpenAI Image API rules

## `gpt-image-2` size validation

Validate custom sizes with these rules:
- longest edge `<= 3840`
- width and height are multiples of 16
- aspect ratio `<= 3:1`
- total pixels between `655360` and `8294400`

## Allowed `quality` values

- `low`
- `medium`
- `high`
- `auto`

## Output handling

The Image API returns base64 image data.
The script decodes `b64_json`, writes image files to disk, and writes a metadata sidecar JSON file.
