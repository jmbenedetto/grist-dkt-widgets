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
- Creates an inactive `Entrada_VersoesPlano` row with `flag_ativo = 0`.
- Populates missing `Apoio_ProjecaoEstoque` support rows for the new plan version.
- Copies classified support input values from `Apoio_ProjecaoEstoque` into `SaidaDados_ProjecaoEstoque`.
- Persists generation status fields on `Entrada_VersoesPlano`:
  - `status_geracao`.
  - `qtd_linhas_geradas`.
  - `gerado_em`.
  - `erro_geracao`.

## Activation

The widget does not activate a plan version. The created row remains inactive. Planners must review the generated rows and activate manually outside this widget.
