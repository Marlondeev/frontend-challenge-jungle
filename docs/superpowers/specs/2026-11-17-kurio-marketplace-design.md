# Kurio — desenho da solução

Status: implementação autorizada; validação final em andamento.

## Objetivo e referências

Construir o marketplace Kurio para o teste técnico da Jungle Gaming, reproduzindo a composição do PDF fornecido e os comportamentos do [README oficial](https://github.com/junglegaming/frontend-challenge).

Referência visual local: `C:/Users/Marlon Araújo/Downloads/Frontend Challenge.pdf`. A exportação tem nove frames desktop de 1440 px e seis mobile de 414 px. Perfil, gestão de carteiras e confirmação precisam de composição mobile derivada dos desktops. A validação também considerará 390 e 768 px.

O resultado esperado é uma aplicação navegável, com descoberta de NFTs, conta e compra simulada. A identidade usa fundo escuro, superfícies marrons, destaque cobre/laranja, textos claros e imagens de colecionáveis.

## Requisitos do enunciado

- React, TypeScript, TanStack Router/Query, Axios, REST, Socket.IO, Tailwind CSS, shadcn/ui, MSW, Playwright e Lighthouse com uso efetivo.
- Catálogo, detalhe, carrinho, pagamento, confirmação, login, cadastro, perfil e carteiras responsivos.
- Busca/filtros/ordenação/paginação na URL; favoritos, sessão e carrinho persistentes; isolamento entre usuários.
- API simulada com falhas reproduzíveis; cotação revalidada, precisão decimal, pedidos idempotentes e recibo imutável.
- Eventos de NFT e pedido pelo cliente Socket.IO, com deduplicação e reconciliação após reconexão.
- Carregamento, vazio, erro, recuperação, atualização otimista com rollback e acessibilidade.
- Testes E2E e regressão visual; auditorias Lighthouse; documentação e aplicação publicada.

## Abordagens e decisões propostas

O caminho apropriado é uma SPA com Vite, usando a stack exigida. A implementação será construída diretamente neste projeto, que atualmente não contém aplicação nem repositório Git. Uma biblioteca ou framework que substitua Router, Query ou MSW contrariaria o enunciado; uma reprodução apenas estática não atenderia aos fluxos.

As decisões abaixo são propostas técnicas do implementador, não preferências já expressas pelo usuário. A prioridade é preservar o visual e produzir uma solução compreensível e reproduzível, sem acrescentar serviços reais de blockchain, pagamento ou OAuth.

## Arquitetura proposta

- `src/app`: inicialização dos mocks antes da interface, roteamento, provedores de Query e sessão.
- `src/components/ui`: componentes shadcn/ui adaptados à identidade Kurio, com foco, labels e diálogos acessíveis.
- `src/components/layout`: cabeçalho, rodapé, estrutura de conta e navegação mobile.
- `src/features/catalog`, `nft`, `cart`, `checkout`, `auth` e `account`: páginas, formulários e hooks de cada fluxo.
- `src/lib`: cliente Axios, validação, precisão monetária e tratamento comum de erros.
- `src/mocks`: dados iniciais, banco simulado, handlers REST, transporte Socket.IO e cenários.
- `public/assets`: imagens e fontes servidas localmente.
- `tests/e2e`: jornadas, cenários de recuperação e baselines visuais estáveis.

Os componentes consomem hooks tipados e não conhecem fixtures. O Axios é a única entrada para REST. TanStack Query mantém o estado remoto; Router mantém navegação, parâmetros e proteção das rotas. MSW responde com o mesmo contrato em desenvolvimento, testes e demonstração publicada.

## Dados, sessão e valores

Os recursos serão NFT/edição, usuário, carteira, item de carrinho, cotação e pedido. Cada consulta privada incluirá a identidade do usuário na chave. Logout e troca de conta limparão o cache privado e os listeners correspondentes.

Preço, desconto, taxa e total trafegam como strings decimais. O domínio converterá ETH para unidades inteiras usando BigInt, evitando aritmética financeira com ponto flutuante. As quantidades serão inteiras e limitadas pela disponibilidade da edição.

O banco simulado terá pelo menos dois usuários fictícios, persistência versionada e reset integral. As credenciais serão fictícias; senhas serão verificadas por hash com salt. Sessões usarão identificador opaco e expiração verificável. O carrinho visitante será reconciliado no login, sem perder itens nem ultrapassar o estoque.

## Fluxos e comportamento

O catálogo terá busca, coleções, rede, faixa de preço, abas, ordenação e paginação combináveis. A alteração de filtros retorna à primeira página; a URL restaura o contexto no histórico e após refresh. Detalhes suportam acesso direto e recursos inexistentes.

O carrinho terá edição de quantidade, remoção e cupom. O checkout recupera os dados da conta, permite selecionar carteira/rede simuladas e solicita cotação antes de enviar. Mudanças na cotação pedem nova revisão. Uma chave de idempotência identifica a tentativa de compra; timeout ou refresh recuperam o mesmo pedido. O comprovante é construído a partir do snapshot confirmado.

No desktop, login e cadastro seguirão os modais do PDF, com rota acessível diretamente e retorno ao fluxo de origem. No mobile, terão apresentação de página inteira. Perfil e carteiras terão formulários e respostas de validação coerentes com o desenho.

Login social e recuperação de senha não serão apresentados como integrações reais. Ações auxiliares fora do escopo terão feedback explícito e coerente.

## Tempo real e cenários

O cliente real `socket.io-client` receberá `nft.updated` e `order.updated` por um adaptador compatível com MSW. Os envelopes terão identificador, recurso e versão. Eventos duplicados ou antigos não reaplicarão efeitos nem regredirão pedidos terminais.

Após reconexão, as consultas ativas serão reconciliadas com REST. Um preço alterado no carrinho invalidará a cotação antes da confirmação. Pedidos pendentes serão recuperáveis sem nova compra. Os testes controlarão os eventos pelo transporte e os cenários pela camada de mocks.

Os cenários incluirão sucesso, vazio, lentidão, respostas fora de ordem, HTTP 4xx/5xx, expiração de sessão, conflito de cadastro, cupom inválido/expirado, esgotamento, alteração de preço, pagamento recusado e timeout após criação do pedido.

## Fidelidade e acessibilidade

A primeira referência é a composição completa do PDF: proporções, respiros, imagens, hierarquia, cards, menus, formulários e rodapé. Mobile será uma adaptação própria, não uma miniatura do desktop. A barra inferior da home não será propagada automaticamente para fluxos em que o PDF não a apresenta.

Valores confirmados pelo usuário em capturas do painel de inspeção do Figma:

- Estilo `Display/43 Bold`: tamanho 43 px, peso 700, entrelinha 70 px e espaçamento entre letras 0%.
- Estilo de corpo de 14 px regular: peso 400, entrelinha 24 px e espaçamento entre letras 0%.
- Cor `Text/Secondary`: `#CFB28C`.
- Ambos os estilos mostram a variável `font/family`. A leitura posterior da cópia local do Figma confirmou seu valor: **Roboto Mono**.

As quatro artes originais dos NFTs foram extraídas da cópia `.fig` em 1254 x 1254 px, sem alteração dos bytes; seus pixels também foram comparados com as artes do PDF. O `.fig`, o PDF, as fontes oficiais locais, as 46 variáveis, os 101 estilos e a estrutura completa dos componentes foram preservados em `design-reference/`. A fonte principal é Roboto Mono; Inter Semi Bold aparece em oito textos editoriais da home desktop. As versões oficiais locais dessas famílias e suas licenças estão arquivadas, com a ressalva de que a versão binária instalada pelo autor não foi comprovada. O índice offline é `design-reference/index.html`.

Há inconsistências de dados demonstrativos, como subtotal do carrinho mobile e opções de edição repetidas. A aplicação usará dados consistentes e totais calculados, mantendo o padrão visual. Skeletons preservarão dimensões, com movimento reduzido; teclado, foco, contraste e mensagens associadas aos campos serão verificados.

## Validação e entrega

A validação funcional seguirá as jornadas e falhas do README, com Playwright em Chromium desktop/mobile e regressão de início, detalhe, carrinho e pagamento. Baselines serão revisadas visualmente contra o PDF antes de serem aceitas; snapshots da própria implementação não serão tratados como prova isolada de fidelidade.

O build será auditado com Lighthouse nas páginas início e detalhe, em mobile e desktop, com três execuções por combinação. Serão reportadas medianas e métricas LCP, CLS e TBT. Metas: Performance 90, Acessibilidade 95, Boas Práticas 95 e SEO 90.

README e ARCHITECTURE explicarão setup, credenciais, cenários, reset, contratos, cache, sessão, reconciliação e limitações. O deploy usará assets locais, mocks ativos e fallback de rotas para acesso direto. A publicação depende de um destino de hospedagem acessível; o usuário receberá o estado real da validação e eventuais pendências.

## Sequência proposta

1. Recuperar os assets e estabelecer tokens e componentes de base.
2. Definir contratos e simulação persistente, REST e Socket.IO.
3. Construir catálogo e detalhe em desktop/mobile.
4. Integrar conta, carrinho, checkout e confirmação.
5. Exercitar falhas, reconexão, isolamento e acessibilidade.
6. Comparar visualmente, executar auditorias, documentar e preparar publicação.

## Critério de conclusão

A entrega estará pronta quando os fluxos previstos funcionarem com mocks, a composição estiver conferida contra as referências nos tamanhos exigidos, os testes e auditorias tiverem evidências reproduzíveis e a publicação estiver acessível. Não se promete equivalência pixel a pixel antes da conferência dos assets e da comparação final.

Revisão independente do desenho: nenhuma questão importante pendente para elaborar o plano técnico.
