# Login social no desafio

## Demonstração funcional

O projeto usa autenticação simulada por MSW. Os botões Google e Facebook abrem uma confirmação que informa esse modo antes de criar uma sessão. Nenhuma conta externa, senha ou token de provedor é solicitado.

| Botão | Perfil fictício |
|---|---|
| Google | Colecionador, `user-collector` |
| Facebook | Nova, `user-nova` |

A confirmação chama `POST /api/session/social-demo` com `{ "provider": "google" }` ou `{ "provider": "facebook" }`. O mock escolhe a identidade pelo identificador fixo e devolve o contrato normal de sessão. O carrinho visitante é mesclado uma única vez, na primeira requisição autenticada com o token aceito pelo cliente. Assim, uma resposta lenta cancelada não consome os itens do visitante. A sessão, o perfil, as carteiras e o carrinho seguem as mesmas regras das contas de e-mail/senha. Cancelar a confirmação encerra a tentativa.

Esse endpoint pertence à demonstração. Com `VITE_MOCKS=false`, ele não substitui uma integração OAuth real.

## Para acessar contas reais

Essa versão ainda não está conectada a aplicativos Google/Meta. Colocar apenas um nome ou e-mail retornado pelo navegador na sessão não comprova identidade: a integração real precisa validar a credencial no serviço de autenticação antes de criar a sessão da aplicação.

Para Google, crie um cliente OAuth do tipo Web no Google Cloud e configure as origens permitidas, incluindo o endereço local usado no desenvolvimento e o domínio HTTPS publicado. O identificador público é usado pelo Google Identity Services. O backend deve verificar o ID token, incluindo assinatura, destinatário, emissor e validade, e identificar a pessoa pelo `sub`. Veja [configuração oficial](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) e [validação no servidor](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Para Facebook, cadastre um aplicativo Meta para website, habilite Facebook Login e configure os domínios/URLs permitidos. A documentação do SDK exige uma página HTTPS para autenticação e usa o App ID da aplicação. Confira os passos no [guia oficial da Meta](https://developers.facebook.com/documentation/facebook-login/web).

Client Secret e App Secret pertencem ao servidor; não devem ser colocados em variáveis `VITE_*`, no código do frontend ou no chat. A ativação real depende desses aplicativos e de um backend/serviço de autenticação configurado; este projeto permanece uma demonstração estática com dados locais.
