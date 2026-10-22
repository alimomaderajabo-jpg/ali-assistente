# Ali Assistente — instruções

## O que tens aqui
- server.js: o servidor (contas, sessões, dados por conta, proxy do Gemini, área admin).
- public/index.html: a app. Já não tem chave do Gemini nem guarda contas no telemóvel.
- scripts/make-admin.js: dá a função de administrador (só no servidor).
- test/: testes automáticos (python não é preciso, só Node).

## Variáveis de ambiente (no Render: Environment)
- GEMINI_API_KEY: a tua chave do Google AI Studio. Nunca a metas no código.
- GEMINI_MODEL: nome do modelo (ex.: gemini-2.5-flash). Confirma no Google AI Studio qual está disponível.
- DAILY_LIMIT: pedidos à IA por conta e por dia. Por defeito 200.
- COOKIE_SECURE: põe 1 (o Render usa HTTPS).
- DATA_DIR: pasta da base de dados. Ver o aviso sobre persistência abaixo.

## Passos (Render, pelo telemóvel)
1. No GitHub, substitui o server.js antigo pelo novo e envia também public/, scripts/, test/, package.json e .gitignore.
2. No Render, em Environment, acrescenta GEMINI_API_KEY, GEMINI_MODEL, COOKIE_SECURE=1.
3. Em Build Command põe: npm install (não há pacotes externos, mas não faz mal).
4. Em Start Command põe: npm start.
5. Faz Manual Deploy e abre o link.
6. Cria a tua conta (nome, email, palavra-passe com 8 caracteres ou mais).
7. Para te tornares administrador, no terminal do servidor: node scripts/make-admin.js teunome

## Aviso importante: dados e Render grátis
No plano grátis, o disco do Render é apagado quando o serviço reinicia. Isso apagaria as contas e as conversas. Opções: (a) disco persistente no Render (é pago) e DATA_DIR apontado para lá; (b) mudar a base de dados para PostgreSQL. Até resolveres isto, não consideres os dados garantidos. Confirma o estado atual destes planos na documentação do Render.

## Testes
Num computador com Node 22.13 ou mais recente: npm test. Os testes arrancam o servidor, usam um Gemini de imitação e não gastam a tua chave.

## Limitações conhecidas
- Os dados de cada conta ficam num só bloco (conversas, memória e definições), com acesso só pela sessão da conta. Ainda não são tabelas separadas.
- A recuperação de palavra-passe por email ainda não existe.
- O painel administrativo, para já, é só a API (/api/admin/users). Não tem página própria.
- Os testes do servidor passam; a app no telemóvel e no navegador ainda não foi testada.
