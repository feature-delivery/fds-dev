import express from 'express'
import { createInstallationToken, getInstallationRepos } from '../libs/github-api';
import { GithubOwner, Repository } from '../entity';
const router = express.Router();

const authValidator = function (req: any, res: any, next: any) {
  if (!!!process.env.MANAGMENT_AUTH_KEY) {
    var err: any = new Error('Not authorized! Go back!');
    err.status = 401;
    return next(err);
  }
 
  if (req.headers['auth-key'] !== process.env.MANAGMENT_AUTH_KEY) {
    var err: any = new Error('Not authorized! Go back!');
    err.status = 400;
    return next(err)
  } else {
    return next()
  }
}

router.use(authValidator)

router.post('/refresh-install-token/', async (req, res) => {
  const installId = req.body.installationId
  const owner = await GithubOwner.findOneOrFail({ where: { installationId: installId } })
  await createInstallationToken(installId)
  const acessToken = await createInstallationToken(owner.installationId)
  owner.oldAcessTokens.push(owner.githubAccessToken);
  owner.githubAccessToken = acessToken.token;
  await owner.save()
  res.sendStatus(200)
})

router.post('/reload-owner-repos/', async (req, res) => {
  const installId = req.body.installationId
  const owner = await GithubOwner.findOneOrFail({ where: { installationId: installId } })

  let repos = await getInstallationRepos(owner.githubAccessToken)
  for (let repo of repos) {
    await Repository.updateOrCreate({ githubId: repo.id }, {
      githubId: repo.id,
      name: repo.name,
      rawData: repo as any,
      websiteUrl: repo.html_url,
      owner: owner
    })
  }

  res.sendStatus(200)
})

export default router;