import axios from 'axios';
import jwt from 'jsonwebtoken';
import createAuthRefreshInterceptor from 'axios-auth-refresh';

const GITHUB_API_URL = 'https://api.github.com'

const { firestore } = require('./firebase');

const session = axios.create({
  baseURL: GITHUB_API_URL
})

const refreshAuthLogic = async (failedRequest: any) => {
  let token = failedRequest.config.headers.Authorization.split(' ', 2)[1]
  let owners = await firestore.collection('github_owners', ref => ref.where('github_access_token', '==', token)).get()
  let owner = owners.docs.map(doc => doc)[0]
  let acessToken = await createInstallationToken(owner.data().installation_id)

  await owner.ref.update({ github_access_token: acessToken.token, expires_at: acessToken.expires_at })

  failedRequest.config.headers.Authorization = `token ${acessToken.token}`
  return Promise.resolve()
};

createAuthRefreshInterceptor(session, refreshAuthLogic);

// https://developer.github.com/v3/repos/commits/#list-pull-requests-associated-with-commit
async function getPullRequestsForCommit(owner: string, repo: string, commit_sha: string, token: string) {
  let res = await session.get(`/repos/${owner}/${repo}/commits/${commit_sha}/pulls`, { headers: { 'Accept': 'application/vnd.github.groot-preview+json', 'Authorization': `token ${token}` } })
  return res.data as Octokit.ReposListPullRequestsAssociatedWithCommitResponse
}

async function getCommitStatus(owner: string, repo: string, commit_sha: string, token: string) {
  try {
    let res = await session.get(`/repos/${owner}/${repo}/commits/${commit_sha}/status`, { headers: { 'Authorization': `token ${token}` } })
    return res.data
  } catch (error) {
    console.error(error)
    return;
  }
}

async function getCommitInfo(owner: string, repo: string, commit_sha: string, token: string) {
  let res = await session.get(`/repos/${owner}/${repo}/commits/${commit_sha}`, { headers: { 'Authorization': `token ${token}` } })
  return res.data
}

async function createInstallationToken(installation_id: string) {

  let privateKey = JSON.parse(process.env.GITHUB_PRIVATE_KEY)

  const jwtToken = jwt.sign({
    exp: Math.floor(Date.now() / 1000) + (5 * 60),
    iat: Math.floor(Date.now() / 1000),
    iss: process.env.APP_ID
  }, privateKey.key, { algorithm: 'RS256' });

  try {
    var res = await axios.post(`https://api.github.com/app/installations/${installation_id}/access_tokens`, {}, { headers: { 'Accept': 'application/vnd.github.machine-man-preview+json', 'Authorization': `Bearer ${jwtToken}` } })
    let data = res.data
    return data
  } catch(e) {
    console.log(e)
    return;
  }
}

module.exports = {
  createInstallationToken,

}

export { createInstallationToken, getPullRequestsForCommit, getCommitStatus, getCommitInfo }