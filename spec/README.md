# Sure OpenAPI spec

`sure-openapi.yaml` is `docs/api/openapi.yaml` from [Sure](https://github.com/we-promise/sure), copied byte for byte.

| Sure commit                                | Date       |
| ------------------------------------------ | ---------- |
| `131e786b9373bea821b2be16e35fd8ba89d8af66` | 2026-10-31 |

Pin it to the Sure version your instance runs. Keep the file unmodified (it is excluded from oxfmt) so an update is a plain diff against upstream.

## Updating

```sh
git -C ../sure fetch upstream
git -C ../sure show <commit>:docs/api/openapi.yaml > spec/sure-openapi.yaml
npm run gen:api
```

Then update the table above.

## Known issues

- Three path parameters (`family_exports/{id}`, `family_exports/{id}/download`, `syncs/{id}`) put `format: uuid` next to `schema` instead of inside it, which fails strict OpenAPI validation.
- No operation has an `operationId`, so generated function names are derived from the method and path.
- Responses contain `amount_cents` and `signed_amount_cents`, which the schema does not declare.
