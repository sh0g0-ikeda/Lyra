# README assets required

## Purpose

The public repository does not yet contain a complete, current set of real Lyra
UI screenshots. Do not substitute generated mockups: capture these views from
the running product after removing private stories, email addresses, IDs,
payment data, and other personal information.

Use PNG, sRGB, and a desktop viewport around 1440 by 900 pixels. Crop browser
chrome unless it is needed to show that the live application is running. Keep
the same work, language, and visual theme across all screenshots.

## Required screenshots

### 1. Character GUI

- Recommended file: docs/assets/character-editor.png
- Show the character editor with representative GUI fields and the preview /
  confirmed-reference area.
- Use a fictional character and non-sensitive values.
- Keep the primary controls legible; avoid showing unrelated job or billing
  panels.

README Markdown:

~~~markdown
![Lyra character editor with structured appearance controls](docs/assets/character-editor.png)
~~~

### 2. Story AI

- Recommended file: docs/assets/story-ai.png
- Show an episode story and Story AI's editable proposal or improvement result.
- Use fictional story text cleared for public display.
- Include enough surrounding UI to make the before-image-generation workflow
  understandable.

README Markdown:

~~~markdown
![Lyra Story AI editing a creator-provided episode](docs/assets/story-ai.png)
~~~

### 3. Storyboard and panel editor

- Recommended file: docs/assets/storyboard-editor.png
- Show a page with its panel order, character assignments, situation,
  composition, camera angle, background, and dialogue or speaker fields.
- This is the most important screenshot because it demonstrates Lyra's editable
  intermediate manga-design data.

README Markdown:

~~~markdown
![Lyra editable manga storyboard and panel editor](docs/assets/storyboard-editor.png)
~~~

### 4. Generated manga page

- Recommended file: docs/assets/generated-page.png
- Show a completed manga page produced from the fictional storyboard above.
- Confirm that the artwork and character design are authorized for public use.
- Do not show signed asset URLs or user-identifying metadata.

README Markdown:

~~~markdown
![Manga page generated from the editable Lyra storyboard](docs/assets/generated-page.png)
~~~

## Optional pipeline image

- Recommended file: docs/assets/story-compilation-pipeline.png
- Render the README Mermaid pipeline as a 16:9, high-resolution diagram for demo
  videos and social sharing.
- The Mermaid source in README remains the maintainable source of truth.

## Product Walkthrough block after capture

Replace the temporary explanation in README's Product Walkthrough section with:

~~~markdown
| Character GUI | Story AI |
| --- | --- |
| ![Lyra character editor with structured appearance controls](docs/assets/character-editor.png) | ![Lyra Story AI editing a creator-provided episode](docs/assets/story-ai.png) |

| Storyboard / Panel Editor | Generated Manga Page |
| --- | --- |
| ![Lyra editable manga storyboard and panel editor](docs/assets/storyboard-editor.png) | ![Manga page generated from the editable Lyra storyboard](docs/assets/generated-page.png) |
~~~

Before committing screenshots, inspect every visible field at full resolution
and run a metadata-removal step appropriate for PNG files.
