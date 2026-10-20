# Plan version generator

Planner-facing Grist custom widget for DKT DRP plan-version creation.

## URL

- GitHub Pages: <https://jmbenedetto.github.io/TCD-widget/plan-version-generator/>

## Grist configuration

- Target document: `DRP Inventory Equation Build v2` (`1CC7gYCiRBvpQh2zMsTaCp`).
- Add a custom widget on the planner-facing page `Plan Version Creation`.
- Custom widget URL: `https://jmbenedetto.github.io/TCD-widget/plan-version-generator/`.
- Required access: `full`.

## Runtime behavior

- Reads valid active locations from `Entrada_Locais`.
- Reads existing versions from `Entrada_VersoesPlano` to generate duplicate-safe names.
- Reads products from `Entrada_Produtos` and periods from `Entrada_Periodo`.
- Collects cycle, location, plan name and the inclusive final calendar month.
- Refreshes tables and revalidates the actual request at Create; a cached preview cannot authorize a stale request. Duplicate-safe naming uses the refreshed versions.
- Creates an inactive `Entrada_VersoesPlano` row with `flag_ativo = 0` and saves `ano_mes_final_projecao` before any support/output materialization. The destination must already provide this editable Text column.
- Creates `Apoio_ProjecaoEstoque` support rows only for eligible location products crossed with the selected period subset.
- Copies the existing classified input fields, unchanged, from support into `SaidaDados_ProjecaoEstoque`. Manual overrides and derived output formulas are not copied, and already copied output rows are not refreshed.
- Persists generation status fields on `Entrada_VersoesPlano`:
  - `status_geracao`.
  - `qtd_linhas_geradas`.
  - `gerado_em`.
  - `erro_geracao`.

## Inclusive horizon

Enter cycle and final month as canonical `YYYYMM`, with a real month from 01 through 12. The new-request final month defaults to cycle plus 12 calendar months. For cycle `202610`, this is `202710`, selecting 13 buckets, M00 through M12 inclusive. It is not the enlarged catalog maximum.

The default follows cycle edits only until the final month has been explicitly edited. An explicit value, including a cleared or invalid value, stays unchanged after cycle edits and fails validation when invalid. New-request defaults never update saved version configuration.

The preview shows the selected relative/calendar range and the product × period count used for both support and output. Examples for cycle `202610`:

- Final `202610`: M00 only, one period per product.
- Final `202709`: M00 through M11, 12 periods per product.
- Default final `202710`: M00 through M12, 13 periods per product.
- Explicit final `202801`: M00 through M15, 16 periods per product.

For final index N, the catalog must contain exactly one canonical `MXX` row for every index 0 through N, with matching numeric `idx_periodo`. Missing periods, duplicate required labels/indices, a final month before cycle or an unsupported end reject creation before any version, support or output write. Nothing is clipped or added to the catalog. Unselected later periods do not increase row counts.

## Interrupted generation

The existing Resume button copies only missing output rows from materialized support for a saved `generating` version. It refreshes and validates that version's saved cycle and final month, not the current form/default or the catalog maximum. Current upstream products do not expand an interrupted snapshot.

Before copying, support must be a nonempty rectangular product × saved-period grid with canonical period/product keys and no duplicates. Output must have unique canonical keys and be a subset of support. Contradictions, partial support grids, unavailable configuration and duplicate output keys stop for inspection without writes or automatic resizing. Empty support is not rebuilt. A complete output with an interrupted status can finish its status update after validation. Changing the end month alone does not regenerate an existing snapshot.

Resume derives its product set from saved support. It cannot detect deletion of every support/output row for an entire product because the existing flow does not persist a separate original product manifest. It does not certify equality of copied values or freeze live support before copying missing rows. Previously copied output stays untouched. Coordinate writers; refresh checks are not an atomic lock, and no rollback, automatic retry or restore is provided.

## Offline verification

The change-specific direct Node VM suite runs the real `app.js` and verifies its HTML element IDs with a mocked DOM and mocked Grist API. It creates synthetic data only in memory and makes no network requests. From the project workbench root:

```sh
node --check .tmp/openspec/changes/extend-october-planning-horizon/grist-dkt-widgets/plan-version-generator/app.js
node --test openspec/changes/extend-october-planning-horizon/scripts/generator_horizon.test.cjs
```

These tests do not establish published-source, browser, live formula or deployment acceptance. Hosting URL, Grist bindings and activation flow remain unchanged. Publication and browser QA are separate steps.

## Activation

The widget does not activate a plan version. The created row remains inactive. Planners must review the generated rows and activate manually outside this widget.
