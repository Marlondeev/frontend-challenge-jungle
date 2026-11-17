# Lighthouse: medições da entrega

Optimized production build; default success mocks, all shipped images/fonts/features; fresh Chrome profile for every measurement; Lighthouse standard mobile/desktop simulation.

| Página | Perfil | Performance | Acessibilidade | Boas práticas | SEO | LCP (ms) | CLS | TBT (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| home | mobile | 58 | 100 | 100 | 100 | 4230 | 0.0000 | 3857 |
| home | desktop | 99 | 100 | 100 | 100 | 880 | 0.0080 | 40 |
| detail | mobile | 59 | 100 | 100 | 100 | 3879 | 0.0000 | 2046 |
| detail | desktop | 99 | 100 | 100 | 100 | 991 | 0.0000 | 0 |

Resultados são medianas de 3 execuções por página/perfil. Os relatórios HTML/JSON individuais e o ambiente completo estão neste diretório.

- home/mobile: abaixo da meta em performance; consultar oportunidades e diagnósticos nos relatórios individuais e a análise em ARCHITECTURE.md.
- detail/mobile: abaixo da meta em performance; consultar oportunidades e diagnósticos nos relatórios individuais e a análise em ARCHITECTURE.md.
