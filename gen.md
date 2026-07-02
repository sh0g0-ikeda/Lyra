目的は、Lyla に「長文漫画脚本＋参照画像＋コマ割りテンプレート」から、画像生成モデルに渡せる 構造化プロンプト生成パイプラインを実装させることです。

Codex は既存コードを読んで編集・実行でき、リポジトリ構造や規約に合わせて実装する用途に向いています。また、プロジェクト固有の作業ルールは AGENTS.md に置くと Codex が参照できます。複雑な実装はタスクを分割して、探索・設計・実装・検証を明確にするのが良いです。

Codex に渡す指示文
# Task: Implement Lyla manga prompt-compilation pipeline

You are working on Lyla, an AI manga creation/editor system.

We need to implement a pipeline that converts:
1. a manga page/spread layout reference,
2. character reference images,
3. a structured panel script,
4. optional previous generated page references,

into a clean, model-ready image-generation prompt.

The goal is NOT to generate images directly in this task.
The goal is to implement the prompt-planning and prompt-compilation layer that prepares reliable instructions for an image-generation model.

## Background

Lyla needs to support workflows like this:

- User uploads a panel layout template image.
- User uploads character reference images, for example:
  - Aoi: long black hair, green eyes, navy military uniform, lance user.
  - Leo: blue suit, giant hammer, blue cosmic/star energy.
- User provides a panel script such as Panels 1–13, each with:
  - panel number
  - page side
  - composition
  - action
  - dialogue
  - technique name
  - SFX
- Lyla should convert that input into a coherent image-generation instruction that:
  - preserves layout structure,
  - preserves character consistency,
  - preserves panel order,
  - preserves dialogue/SFX/technique text,
  - explains the role of each reference image,
  - keeps the whole page/spread visually coherent.

## Required output from the pipeline

Given user input, the system should produce a compiled prompt like:

- Overall image type:
  - single manga page / two-page spread
  - full color / monochrome
  - manga/manhwa/anime style
- Layout instructions:
  - use layout reference as panel template
  - left page: panels 1–7
  - right page: panels 8–13
  - preserve center gutter
  - preserve panel shapes
- Reference image role mapping:
  - Image A = layout reference
  - Image B = Aoi character design
  - Image C = Leo character design
  - Image D = previous generated page / style reference, if present
- Global continuity constraints:
  - character consistency
  - weapon consistency
  - setting consistency
  - energy/effect color consistency
  - reading order
- Per-panel instructions:
  - Panel 1: composition, action, dialogue, technique, SFX
  - ...
  - Panel 13: composition, action, dialogue, technique, SFX
- Quality constraints:
  - no omitted panels
  - readable text
  - clear panel borders
  - coherent action progression
  - no extra panels
  - no watermarks

## Implementation requirements

First, inspect the existing repository and identify the right place to implement this. Do not invent a new architecture if a suitable structure already exists.

Implement the feature in small, maintainable modules.

Suggested architecture:

1. `types` or `schemas`
   Define strongly typed data structures for:
   - `MangaProject`
   - `ReferenceImage`
   - `ReferenceImageRole`
   - `CharacterReference`
   - `PageLayout`
   - `PanelScript`
   - `PanelInstruction`
   - `CompiledImagePrompt`
   - `PromptCompileOptions`

2. `parser`
   Implement a parser that can convert semi-structured panel scripts into normalized panel objects.

   It should handle inputs like:
   - CSV-like panel tables
   - markdown tables
   - plain text sections
   - labels such as:
     - Panel No.
     - Composition
     - Action
     - Dialogue
     - Technique / SFX

   The parser does not need to be perfect, but it must be deterministic and testable.

3. `referenceMapper`
   Implement logic that assigns uploaded reference images to roles.

   Required roles:
   - `layout`
   - `character`
   - `style`
   - `previous_output`
   - `background`
   - `unknown`

   The user should be able to explicitly assign roles, but the system should also support simple automatic inference from labels such as:
   - "layout"
   - "Aoi"
   - "Leo"
   - "previous page"
   - "style reference"

4. `promptCompiler`
   Implement the main compiler:

   Input:
   - project title
   - layout information
   - reference images with roles
   - character descriptions
   - panel scripts
   - style settings
   - output options

   Output:
   - final prompt string
   - structured metadata
   - warnings

   The compiler should produce a prompt with these sections:

   ```text
   [TASK]
   [REFERENCE IMAGE ROLES]
   [GLOBAL STYLE]
   [CHARACTER CONSISTENCY]
   [SETTING]
   [LAYOUT]
   [PANEL INSTRUCTIONS]
   [QUALITY CONSTRAINTS]
   [NEGATIVE CONSTRAINTS]

validator
Implement validation checks:

Are panel numbers continuous?
Are there missing panels?
Are there duplicate panels?
Does the layout expect the same number of panels as the script?
Does each panel have at least composition or action?
Are character names referenced in the script present in character references?
Are dialogue and SFX preserved?
Does the prompt exceed a configurable max length?

Return warnings, not hard failures, unless the input is unusable.

promptCompression
Implement optional compression:

preserve panel number
preserve action
preserve dialogue
preserve technique/SFX
shorten redundant style descriptions
move repeated character details into global character section

This is important because long manga scripts can exceed model input limits.

Tests
Add unit tests for:
parsing Panels 1–13 from a script
assigning reference roles
compiling a two-page spread prompt
detecting missing panels
detecting duplicate panel numbers
preserving dialogue/SFX
compression preserving important fields
Example fixture
Add a fixture based on this sample scenario:
Aoi:
long black hair, green eyes, navy military-style uniform with gold trim, lance user, cold expression.
Leo:
muscular man, short black hair, blue suit, giant hammer, blue cosmic/star energy.
Panels:
1–7 on left page
8–13 on right page
Setting:
ruined city rooftop at night.
Output:
full-color two-page manga spread.
Important design constraints
Do not hardcode Aoi or Leo into the compiler logic.
They should only appear in fixtures/examples.
The system must work for arbitrary manga projects.
Keep the compiler deterministic.
Avoid hidden LLM calls inside the compiler for now.
The compiler should be pure logic: input data in, prompt string and warnings out.
Make the output inspectable in the UI later.
Do not generate images in this task.
Do not add large dependencies unless necessary.
If the repository already has schema validation tools, use them.
If using TypeScript, prefer Zod or existing project conventions.
If using Python, prefer Pydantic or existing project conventions.
Deliverables

Please implement:

Core data models.
Panel script parser.
Reference image role mapper.
Prompt compiler.
Validator.
Prompt compression helper.
Unit tests.
One example or fixture showing the full Panels 1–13 two-page spread prompt compilation.

After implementation, run the relevant tests and lint/typecheck commands available in the repository.

At the end, report:

files changed,
architecture summary,
test results,
known limitations,
next recommended tasks.

---

## 追加で `AGENTS.md` に入れるべき指示

Lyla のリポジトリ直下に `AGENTS.md` を置けるなら、以下を入れてください。Codex は `AGENTS.md` のようなプロジェクト指示を読み、作業規約として使えます。:contentReference[oaicite:1]{index=1}

```md
# AGENTS.md

## Project: Lyla

Lyla is an AI manga editor that converts structured story, character, panel, and layout information into manga-generation workflows.

## Engineering principles

- Prefer deterministic transformations before using LLM calls.
- Keep prompt compilation inspectable and testable.
- Separate parsing, validation, prompt compilation, and image-generation execution.
- Do not mix UI logic with prompt-compilation logic.
- Do not hardcode project-specific characters into generic modules.
- Preserve user-authored dialogue, technique names, and SFX exactly unless explicitly asked to rewrite them.
- Use strong typing and schema validation.
- Prefer small modules with clear input/output contracts.
- Add tests for every parser/compiler behavior.

## Prompt compiler rules

The manga prompt compiler should always include:

1. Task definition.
2. Reference image role mapping.
3. Global visual style.
4. Character consistency constraints.
5. Setting and continuity.
6. Layout instructions.
7. Per-panel instructions.
8. Quality constraints.
9. Negative constraints.

## Validation rules

Warn when:
- panel numbers are missing,
- panel numbers are duplicated,
- layout panel count and script panel count differ,
- dialogue or SFX may be dropped,
- character names appear without matching character references,
- compiled prompt exceeds the configured length budget.

## Testing

After modifying prompt compiler, parser, or schema logic, run:
- typecheck
- lint
- unit tests

Use the existing package manager and test commands found in the repository.
実装方針として重要なこと

ここで絶対にやってはいけないのは、いきなり画像生成APIに投げる機能を作ることです。
Lyla の中核はまずこれです。

脚本・参照画像・コマ割り
        ↓
構造化データ
        ↓
検証
        ↓
プロンプトコンパイル
        ↓
画像生成モデルへ送信

今回 Codex に作らせるべきなのは、主にこの部分です。

構造化データ
検証
プロンプトコンパイル

画像生成そのものは後回しでいいです。
理由は単純で、画像生成APIを先に繋ぐと、失敗原因が

入力構造が悪いのか
プロンプトが悪いのか
画像モデルの限界なのか
レイアウト指定が弱いのか
キャラ参照が弱いのか

切り分けられなくなるからです。

最小実装のデータ構造イメージ

TypeScript ならこういう型が最初の核になります。

export type ReferenceImageRole =
  | "layout"
  | "character"
  | "style"
  | "previous_output"
  | "background"
  | "unknown";

export interface ReferenceImage {
  id: string;
  label?: string;
  role: ReferenceImageRole;
  description?: string;
  characterName?: string;
}

export interface CharacterReference {
  name: string;
  description: string;
  referenceImageIds: string[];
  consistencyRules?: string[];
}

export interface PanelInstruction {
  panelNo: number;
  page?: "left" | "right" | "single";
  layoutSlot?: string;
  composition?: string;
  action: string;
  dialogue?: string[];
  technique?: string[];
  sfx?: string[];
  emphasis?: string[];
}

export interface MangaPromptCompileInput {
  projectTitle?: string;
  outputType: "single_page" | "two_page_spread";
  style: string;
  setting: string;
  references: ReferenceImage[];
  characters: CharacterReference[];
  panels: PanelInstruction[];
  qualityConstraints?: string[];
  negativeConstraints?: string[];
  maxPromptLength?: number;
}

export interface CompiledImagePrompt {
  prompt: string;
  warnings: string[];
  metadata: {
    panelCount: number;
    referenceCount: number;
    characterCount: number;
    estimatedLength: number;
  };
}

この設計のポイントは、Aoi / Leo 固有にしないことです。
Aoi と Leo はあくまで CharacterReference の一例です。Lyla のプロダクトとしては、任意のキャラ・任意の脚本に対応できないと弱いです。

Codex への二発目の指示：UIまで進める場合

コア実装が終わったら、次にこう投げるといいです。

# Task: Add prompt compiler preview UI for Lyla

Now that the manga prompt compiler exists, add a UI screen or component that lets the user inspect the compiled prompt before image generation.

Requirements:

- Show uploaded reference images and their assigned roles.
- Allow the user to edit each reference image role:
  - layout
  - character
  - style
  - previous_output
  - background
  - unknown
- Show detected characters.
- Show parsed panels in a table:
  - panel number
  - page
  - composition
  - action
  - dialogue
  - technique
  - SFX
- Show validation warnings.
- Show the final compiled prompt in a read-only text area.
- Add a “Copy prompt” button.
- Add a “Recompile” button after edits.
- Do not call the image-generation API yet.
- Keep the component decoupled from the compiler logic.
- Add basic tests if the project has UI tests.

Follow the existing UI framework and styling conventions in the repository.
Codex への三発目の指示：画像生成API接続

その次です。

# Task: Connect Lyla prompt compiler to image generation request builder

Add an image-generation request builder that takes `CompiledImagePrompt` and selected reference images, and converts them into the request payload expected by the image generation provider.

Important:
- Do not hardcode a single provider too deeply.
- Create a provider-agnostic interface first.
- Implement one concrete adapter for the current provider.
- The adapter should receive:
  - compiled prompt
  - reference image IDs / file handles
  - aspect ratio
  - image count
  - style transfer flag if applicable
- Return:
  - provider payload
  - warnings
  - trace/debug metadata

Do not change the prompt compiler itself.
Keep provider-specific logic outside the compiler.
Add tests for request building.
現実的な優先順位

Lyla のためなら、実装順はこれが最短です。

PanelScript parser
Prompt compiler
Validator
Reference image role mapper
Prompt preview UI
Image generation adapter
結果評価・再生成ループ

特に重要なのは 5. Prompt preview UI です。
ここがないと、ユーザーが「なぜ変な画像が出たのか」を理解できません。

Lyla の価値は、単に画像生成することではなく、

漫画家の意図
↓
構造化
↓
可視化
↓
修正可能
↓
生成

にあります。

だから「裏で勝手にいい感じのプロンプトを作る」だけでは弱いです。
ユーザーが 構造化された意図を編集できるようにするべきです。