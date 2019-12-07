require('dotenv').config();
import dbConnect from './libs/db'

const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

const url = require('url')
const port = process.env.PORT || 3000;

const path = require('path');
const fs = require('fs');
const express = require('express');
const morgan = require('morgan');
const axios = require('axios');

const githubOAuth = require('./oauth-github')

const { createInstallationToken } = require('./libs/github-api')
const { subscribe, emmit } = require('./libs/event.js');
const { firestore } = require('./libs/firebase');
const { honeycomb } = require('./libs/honeycomb');
const { handleCommands } = require('./libs/slack-commands')
const { eventMiddleware } = require('./libs/slack-events')


const app = express();

// The request handler must be the first middleware on the app
app.use(Sentry.Handlers.requestHandler());

let ghOAuth = githubOAuth({
  githubClient: process.env.GITHUB_APP_PUBLIC_KEY,
  githubSecret: process.env.GITHUB_APP_SECRET_KEY,
  baseURL: process.env.GITHUB_OAUTH_BASE_URL,
  loginURI: '/github-login',
  callbackURI: '/github-callback',
  scope: 'user' // optional, default scope is set to user
})

app.use(morgan('dev'));

app.use('/slack/events', eventMiddleware())

app.use(express.json());
app.use(express.urlencoded())

app.use('/slack/commands', express.urlencoded())
app.post('/slack/commands', async (req, res) => {
  handleCommands(req, res)
})

app.post('/slack/events', async (req, res) => {
  res.end();
})

app.get('/github/setup', async (req, res) => {
  let query = url.parse(req.url, true).query
  let installation_id = query.installation_id
  let team_id = query.state
  let setup_action = query.setup_action

  let team = firestore.collection('teams').doc(team_id)

  if (setup_action === 'install') {
    await team.update({
      githubConnected: true
    })

    let data = await createInstallationToken(installation_id)
    let owner = await firestore.collection('github_owners').doc(installation_id)

    owner.set({
      github_access_token: data.token,
      github_access_token_raw: data,
      installation_id: installation_id,
      team_ref: team
    })

    let resRepos = await axios.get(`https://api.github.com/installation/repositories`, { headers: { 'Accept': 'application/vnd.github.machine-man-preview+json', 'Authorization': `token ${data.token}` }})
    let repos = resRepos.data.repositories

    for (let repo of repos) {
      await firestore.collection('repos').doc(repo.id.toString()).set(repo)
      await firestore.collection('repos').doc(repo.id.toString()).update({ app_owner_ref: owner })

    }
  }

  emmit('team.gh.connected', team_id)

  res.end('done')
})


app.get('/github-login', async (req, res) => {
  let query = url.parse(req.url, true).query
  ghOAuth.login(req, res, query.userId)
})


app.get('/github-callback', ghOAuth.callback)

ghOAuth.on('error', function (err) {
  console.error('there was a login error', err)
})


const apiPath = path.join(__dirname, 'api');
fs.readdirSync(apiPath)
  .filter(file => { return (['.js', '.ts'].includes(file.slice(-3))); })
  .forEach(file => {
    let baseRoute = `/api/${path.basename(file).split('.').slice(0, -1).join('.')}`;
    let router = require(path.join(apiPath, file));
    app.use(baseRoute, router);
  });


const subscribersPath = path.join(__dirname, 'subscribers');
fs.readdirSync(subscribersPath)
.filter(file => { return (['.js', '.ts'].includes(file.slice(-3))); })
  .forEach(file => {
  	subscribe();
  	let subscribers = require(path.join(subscribersPath, file)).forEach(subscriber => {
  		subscribe(subscriber.eventType,  subscriber);
  	});
  });

app.get('/debug-sentry', function mainHandler(req, res) {
  throw new Error('My first Sentry error!');
});

// The error handler must be before any other error middleware and after all controllers
app.use(Sentry.Handlers.errorHandler());

app.use(function onError(err, req, res, next) {
  // The error id is attached to `res.sentry` to be returned
  // and optionally displayed to the user for support.
  res.statusCode = 500;
  res.end(res.sentry + "\n");
});

(async() => {
  var db = await dbConnect();
  await db.synchronize();
  app.listen(port, err => {
    if (err) throw err
    console.log(`> Ready on server http://localhost:${port}`)
  });
})();