# rumblebotbichou

Bot Node.js pour le chat Rumble, avec relay vers le site et API interne de controle.

## Prerequis

- Node.js 20+ (22 recommande)
- MySQL accessible depuis le serveur

## Installation locale

```bash
npm install
cp .env.example .env
npm start
```

Le bot expose un endpoint de sante sur :

```text
GET /health
```

Le port par defaut est `4010`, configurable via `RUMBLE_BOT_HTTP_PORT`.

## Variables d'environnement

Les variables minimales pour demarrer sont dans `.env.example`.

Les plus importantes :

- `DB_HOST`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`
- `BOT_SECRET`
- `SITE_BASE_URL`
- `RUMBLE_SESSION_COOKIE`
- `RUMBLE_CHANNEL_ID`
- Au moins un couple `RUMBLE_STREAM_ID_*` ou `RUMBLE_LIVE_API_URL_*`

## Deploiement Dokploy

Option recommande :

1. Push ce dossier sur un repo GitHub.
2. Cree une nouvelle application dans Dokploy.
3. Choisis ce repo comme source.
4. Utilise le `Dockerfile` du projet.
5. Renseigne les variables d'environnement depuis `.env.example`.
6. Deploy.

Si tu n'utilises pas Docker dans Dokploy :

- Build command : `npm install`
- Start command : `npm start`
- Internal port : `4010`

## Notes

- `BOT_SECRET` sert au relay/API avec le site.
- `RUMBLE_BOT_CONTROL_TOKEN` protege l'API interne `/internal/admin/commands/execute`.
- `RUMBLE_SESSION_COOKIE` est obligatoire sinon le bot quitte immediatement.
