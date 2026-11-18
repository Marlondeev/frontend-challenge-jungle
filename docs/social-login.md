# Login social no desafio

O projeto oferece três modos. Os comandos padrão mantêm MSW e perfis fictícios. `google-demo` usa Google Identity Services (GIS), uma função Vercel sem banco e dados fictícios temporários na aba. A variante opcional `google` usa um servidor Node local com armazenamento privado persistente. NFTs, carteiras, pagamentos e compras continuam fictícios em todos os modos.

## Demonstração padrão

Execute `npm run dev`, ou `npm run build` seguido de `npm run preview`. Os botões Google e Facebook abrem uma confirmação explícita de demonstração. Nenhuma conta externa, senha ou token de provedor é solicitado.

| Botão    | Perfil fictício                |
| -------- | ------------------------------ |
| Google   | Colecionador, `user-collector` |
| Facebook | Nova, `user-nova`              |

A confirmação chama `POST /api/session/social-demo` com `{ "provider": "google" }` ou `{ "provider": "facebook" }`. O mock escolhe a identidade pelo identificador fixo e devolve o contrato normal de sessão. O carrinho visitante é mesclado uma única vez, na primeira requisição autenticada com o token aceito pelo cliente. Uma resposta lenta cancelada não consome os itens do visitante. Cancelar a confirmação encerra a tentativa.

Esses dados ficam no navegador. Esse endpoint e `/api/__control` não são expostos pelo servidor do modo Google.

## Google real na Vercel, sem banco

`vercel.json` executa `npm run build:google-demo`, publica `dist/` e mantém `/api/google-auth` fora do fallback SPA. Essa rota é uma Node Function incluída no projeto. Não é necessário hospedar outro serviço ou criar um banco.

O Client ID OAuth público padrão está em `config/google-client.ts`. O build e a função usam o mesmo valor; ele não é um segredo. **Nenhuma variável de ambiente é obrigatória na Vercel e o fluxo não usa Client Secret.** Se quiser trocar o cliente, defina `VITE_GOOGLE_CLIENT_ID` no projeto Vercel e faça um novo deploy, atualizando frontend e função juntos.

O endereço informado para o site é [frontend-challenge-jungle-delta.vercel.app](https://frontend-challenge-jungle-delta.vercel.app). Abra o cliente OAuth Web no Google Cloud e adicione `https://frontend-challenge-jungle-delta.vercel.app`, sem barra final ou caminho, em **Origens JavaScript autorizadas**. A verificação do novo deploy e o login em uma conta externa ainda não estão confirmados. As origens locais `http://localhost:5173` e `http://localhost:4173` permitem conferir o mesmo fluxo com:

```sh
npm run dev:google-demo
```

Ou, para o build e preview:

```sh
npm run build:google-demo
npm run preview:google-demo
```

O desenvolvimento usa a porta 5173 e o preview 4173. O plugin local fornece a mesma função sem banco. Tanto `build:google-demo` quanto `build` escrevem em `dist/`; gere a variante desejada antes de iniciar seu preview. `build` continua sendo a demonstração padrão com login social fictício.

`GET /api/google-auth` emite nonce com timestamp e cookie `HttpOnly`, `SameSite=Strict`, com validade de cinco minutos. `POST /api/google-auth` recebe `{ credential, nonce }`, exige origem compatível, cookie correspondente e prazo válido, verifica o ID token com o verificador oficial e retorna `{ identity }`. O cookie é limpo na tentativa. Esse desafio é stateless e não possui um registro durável de uso único.

O Google realmente confirma a conta escolhida. Depois da verificação, a interface cria apenas a sessão do marketplace fictício no navegador. Perfil, token do aplicativo, visitante, favoritos, carrinho e banco simulado ficam em `sessionStorage`, somente na aba. Atualizar a aba preserva o estado; fechá-la e abrir uma aba independente ou contexto novo começa como visitante. O ID token Google não é persistido. A função não armazena usuários, sessões de aplicativo ou compras, e não oferece um backend protegido para esses dados locais.

Contas Google não recebem senha local nem carteira automática. Facebook fica desabilitado porque o aplicativo Meta não foi configurado. A Vercel e os servidores locais configuram `Cross-Origin-Opener-Policy: same-origin-allow-popups` para o popup do Google.

## Servidor Google local, opcional

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

### Validação e dados do servidor local

`GET /api/session/google/challenge` emite um nonce e um cookie de desafio `HttpOnly`, `SameSite=Strict`, com prazo de cinco minutos. O GIS recebe esse nonce. O navegador envia `{ credential, nonce }` a `POST /api/session/google` na mesma origem.

O servidor consome o desafio uma única vez e verifica o ID token com `google-auth-library`: assinatura, algoritmo, destinatário, emissor, validade, e-mail verificado e nonce. Somente depois chama o método interno `backend.loginGoogle`. O domínio não expõe um endpoint que autentique um nome ou e-mail declarado pelo navegador. As requisições também validam origem e limites de corpo; credenciais não são registradas em logs.

A conta é vinculada ao `sub` estável do Google. Retornar preserva o perfil editado, favoritos e carrinho; um e-mail coincidente não vincula automaticamente contas existentes. Contas Google não recebem senha local nem carteira fictícia automática, e a seção de senha do perfil explica que ela é gerenciada pelo Google. O carrinho visitante só é transferido depois que o token emitido é aceito, uma única vez. Sessões têm validade de uma hora.

O servidor persiste contas, sessões e dados do marketplace em `tmp/google-auth/`, ignorado pelo Git e bloqueado para acesso HTTP. A gravação usa substituição atômica do arquivo e bloqueio de processo único; reiniciar o servidor preserva os dados. O navegador guarda o token da aplicação e os rascunhos locais, não o banco privado do servidor. Uma credencial Google real não torna o catálogo, as carteiras ou as compras reais.

## Verificação e hospedagem

A implementação hospedada passou por **161 testes unitários/de rede em 22 arquivos**, lint e verificação de tipos. `npm run test:hosted-google` concluiu **10 E2E em desktop/mobile**, e a regressão direcionada do build de produção padrão concluiu **36 E2E**, ambas com encerramento bem-sucedido. Veja os relatórios [Google hospedado](../reports/hosted-google/index.html) e [regressão padrão](../reports/hosted-google-regression/index.html). A suíte hospedada usa verificador controlado; a verificação do novo deploy e a seleção de uma conta Google externa ainda não estão confirmadas.

Os resultados **137 testes em 16 arquivos**, **152 E2E padrão** e **12 E2E Google local** são históricos da implementação `5fcce7a`, publicada antes desta revisão em `fd1090f`. Permanecem disponíveis o [relatório padrão](../reports/google-demo-regression/index.html) e o [relatório Google local](../reports/google-auth/html/index.html). `test:google` e `test:hosted-google` usam verificadores controlados exclusivamente pelos servidores de teste; não autenticam uma conta externa. A conferência anterior do SDK em 320, 390 e 1440 px pertence à versão local anterior.

O modo `google-demo` já inclui a função Vercel e não exige banco ou serviço separado. A variante persistente `google` atende API Node e Socket.IO na mesma origem; publicar apenas `dist-google/` não fornece esses serviços. Essa variante completa exige hospedar seu backend e armazenamento privado, com HTTPS e origens autorizadas. O preview Vite serve para conferência local. Uma hospedagem puramente estática pode executar a demonstração padrão; Google real no modo hospedado depende também da função `/api/google-auth` incluída no deploy Vercel.

Referências: [configuração do cliente Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [validação de ID token no servidor](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) e [Facebook Login](https://developers.facebook.com/documentation/facebook-login/web).
