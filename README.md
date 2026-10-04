# Ali Assistente — Versão 1

Base inicial real do Ali Assistente, seguindo a especificação do projeto oficial.

## Incluído nesta versão

- Cadastro e login por e-mail e senha
- Sessão autenticada
- Chat com IA via backend
- Histórico de conversas por usuário
- Memória separada do histórico
- Envio de imagens para análise pela IA
- Interface responsiva para celular e computador
- Geração de PDF
- Banco SQLite local
- Arquitetura preparada para futuras versões

## Requisitos

Node.js 18 ou superior.

## Instalação

```bash
npm install
```

Copie `.env.example` para `.env` e configure:

```env
PORT=3000
JWT_SECRET=uma-chave-secreta-forte
ANTHROPIC_API_KEY=sua-chave-da-api
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Depois:

```bash
npm start
```

Abra:

`http://localhost:3000`

## Importante

A chave da API fica somente no servidor. Nunca coloque `ANTHROPIC_API_KEY` dentro do HTML ou JavaScript público.

Esta é uma base funcional de desenvolvimento. Para colocar o serviço na internet serão necessários HTTPS, armazenamento/backup adequado, política de privacidade, proteção contra abuso, limites de utilização e configuração segura do servidor.
