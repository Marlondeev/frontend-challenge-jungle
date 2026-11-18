# Login social no desafio

O projeto oferece dois modos independentes. Os comandos padrão mantêm a demonstração com MSW e perfis fictícios. O modo opcional `google` usa o Google Identity Services (GIS) e um servidor Node local para validar uma conta Google real. NFTs, carteiras, pagamentos e compras continuam fictícios nos dois modos.

## Demonstração padrão

Execute `npm run dev`, ou `npm run build` seguido de `npm run preview`. Os botões Google e Facebook abrem uma confirmação explícita de demonstração. Nenhuma conta externa, senha ou token de provedor é solicitado.

| Botão    | Perfil fictício                |
| -------- | ------------------------------ |
| Google   | Colecionador, `user-collector` |
| Facebook | Nova, `user-nova`              |

A confirmação chama `POST /api/session/social-demo` com `{ "provider": "google" }` ou `{ "provider": "facebook" }`. O mock escolhe a identidade pelo identificador fixo e devolve o contrato normal de sessão. O carrinho visitante é mesclado uma única vez, na primeira requisição autenticada com o token aceito pelo cliente. Uma resposta lenta cancelada não consome os itens do visitante. Cancelar a confirmação encerra a tentativa.

Esses dados ficam no navegador. Esse endpoint e `/api/__control` não são expostos pelo servidor do modo Google.

## Google real no ambiente local

O cliente OAuth deve ser do tipo **Aplicativo da Web**. Configure as origens JavaScript autorizadas do Google Cloud para o endereço efetivamente aberto no navegador, incluindo esquema e porta. A configuração local usa `http://localhost:5173` no desenvolvimento e `http://localhost:4173` no preview. Se usar `127.0.0.1`, autorize também a origem correspondente: ela é diferente de `localhost`.

Copie `.env.google.example` para `.env.google.local` e preencha somente o identificador público do cliente:

```dotenv
VITE_GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
```

Neste workspace, `.env.google.local` já está configurado e é ignorado pelo Git. Não é necessário fornecer **Client Secret** para esse fluxo de ID token. O identificador público pode aparecer no frontend; segredos nunca devem entrar em variáveis `VITE_*`.

```sh
npm run dev:google
```

Abra `http://localhost:5173`. Para usar o build separado:

```sh
npm run build:google
npm run preview:google
```

Abra `http://localhost:4173`. O build fica em `dist-google/`; o build padrão permanece em `dist/`. `.env.google` desativa MSW e ferramentas de demonstração e ativa `VITE_GOOGLE_LOGIN=real`. As portas são fixas nesse modo. Encerre o servidor `dev:google` antes de iniciar `preview:google`: ambos usam o mesmo armazenamento e apenas um processo pode gravá-lo.

O botão oficial do Google abre a seleção de conta. A interface oferece cancelamento, mensagens de erro e nova tentativa; uma resposta tardia de um popup cancelado não substitui uma autenticação mais recente. O login contextual mantém o NFT ou o carrinho que abriu o formulário. Facebook fica desabilitado nesse modo, com a explicação de que o aplicativo Meta ainda não foi configurado.

## Validação e dados

`GET /api/session/google/challenge` emite um nonce e um cookie de desafio `HttpOnly`, `SameSite=Strict`, com prazo de cinco minutos. O GIS recebe esse nonce. O navegador envia `{ credential, nonce }` a `POST /api/session/google` na mesma origem.

O servidor consome o desafio uma única vez e verifica o ID token com `google-auth-library`: assinatura, algoritmo, destinatário, emissor, validade, e-mail verificado e nonce. Somente depois chama o método interno `backend.loginGoogle`. O domínio não expõe um endpoint que autentique um nome ou e-mail declarado pelo navegador. As requisições também validam origem e limites de corpo; credenciais não são registradas em logs.

A conta é vinculada ao `sub` estável do Google. Retornar preserva o perfil editado, favoritos e carrinho; um e-mail coincidente não vincula automaticamente contas existentes. Contas Google não recebem senha local nem carteira fictícia automática, e a seção de senha do perfil explica que ela é gerenciada pelo Google. O carrinho visitante só é transferido depois que o token emitido é aceito, uma única vez. Sessões têm validade de uma hora.

O servidor persiste contas, sessões e dados do marketplace em `tmp/google-auth/`, ignorado pelo Git e bloqueado para acesso HTTP. A gravação usa substituição atômica do arquivo e bloqueio de processo único; reiniciar o servidor preserva os dados. O navegador guarda o token da aplicação e os rascunhos locais, não o banco privado do servidor. Uma credencial Google real não torna o catálogo, as carteiras ou as compras reais.

## Verificação e hospedagem

A rodada de integração passou por **137 testes unitários/de rede em 16 arquivos**, lint, verificação de tipos e builds padrão/Google. A regressão do build de produção padrão concluiu **152 E2E em desktop/mobile**, antes do ajuste final de CSS exclusivo do modo Google. O [relatório dessa regressão](../reports/google-demo-regression/index.html) está incluído; os relatórios anteriores documentam a demonstração nas versões indicadas.

`npm run test:google` concluiu **12 E2E em desktop/mobile**, com encerramento bem-sucedido; veja o [relatório Google](../reports/google-auth/html/index.html). Essa suíte usa um verificador controlado exclusivamente pelo servidor de testes e não autentica uma conta Google externa. O SDK oficial também foi conferido em 320, 390 e 1440 px, sem rolagem horizontal ou erros de página. A escolha de uma conta real pelo usuário permanece pendente.

Os comandos de desenvolvimento e preview incluem a API Node e Socket.IO na mesma origem. Copiar apenas `dist-google/` para uma hospedagem estática não fornece esses serviços. Uma publicação do modo Google exige hospedar o backend Node, armazenamento privado persistente, HTTPS e configurar as origens permitidas no servidor e no Google Cloud. O preview Vite é uma ferramenta local, não uma configuração de servidor de produção. Os arquivos atuais de Vercel/Netlify atendem à demonstração estática padrão.

Referências: [configuração do cliente Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [validação de ID token no servidor](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) e [Facebook Login](https://developers.facebook.com/documentation/facebook-login/web).
