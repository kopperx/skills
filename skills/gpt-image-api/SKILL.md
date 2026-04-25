---
name: gpt-image-api
description: Use this skill for GPT Image or OpenAI Image API work that is more than a one-off answer generating images, editing images, combining reference images, carrying image context across turns, or building a reusable Python CLI around image generation. Trigger even if the user does not explicitly ask for a skill when they are clearly asking for image generation automation or an OpenAI image script.
---

# GPT Image API

Prefer `gpt-image-2` unless the user explicitly requests another compatible model.

Use OpenAI Image API, not Responses API.

Use `uv run python` for Python execution unless the user explicitly asks otherwise.

## Scope

This version supports:
- text-to-image generation
- single-image edit
- multi-image reference composition
- reusable Python CLI wrapping

This version does not expose:
- mask editing
- format or compression controls
- background or moderation controls
- streaming or partial images

## Task mode

Choose one:
- `generate`: create a new image from text
- `edit`: edit one image
- `edit` with repeated `--image`: use multiple images as references for a new composition

## Context handling

Manage image prompt context in the conversation.
Before each API call, rewrite the prompt into a self-contained final prompt.
Include only what matters:
- subject
- style
- composition
- lighting or mood
- must-keep elements
- newly requested changes
- role of each reference image

Do not pass the latest user sentence raw when it depends on earlier turns.

## Key parameter choices

### `size`
- If the user specifies `size`, use it.
- Otherwise choose one:
  - `1024x1024`: square, icons, logos, avatars, single-object images
  - `1024x1536`: portraits, posters, covers, character art
  - `1536x1024`: landscapes, product scenes, banners, multi-object layouts
- If unclear, use `1024x1024`.
- See `references/image_api_rules.md` for validation rules.

### `quality`
- If the user specifies `quality`, use it.
- Otherwise default to `high`.
- Choices: `low` | `medium` | `high` | `auto`

### `model`
- Default: `gpt-image-2`
- Allow override when the user explicitly wants another compatible model.

## Before running the script

Check:
- mode is correct
- image paths exist for `edit`
- at least one `--image` is present for `edit`
- `size` is valid
- `quality` is valid

## Run the script

Use:
- `uv run scripts/gpt_image.py generate ...`
- `uv run scripts/gpt_image.py edit ...`

Pass the rewritten final prompt, not a context-dependent fragment.

## Output

Report:
- output file path(s)
- mode
- model
- size
- quality
- input image path(s), if any
- metadata file path when useful
