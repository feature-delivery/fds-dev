import { strict as assert } from 'assert'
import httpContext from 'express-http-context'
import { ICommitCheck } from '../events/types'
import {PullRequest,Team,Pipeline,Commit,CommitCheck} from '../entity'
import { jobDetails, workflowDetails } from '../libs/circleci-api';

const CIRCLE_JOB_PREFIX = 'ci/circleci: ';

export function isCircleCheck(check: ICommitCheck) {
	assert(check.name, 'Check is missing name')
	return check.name && check.name.includes(CIRCLE_JOB_PREFIX)
}

function isSameCheck(check: CommitCheck, githubCheck: ICommitCheck) {
	// TODO: approval name syntax
	// ci/circleci: build vs ci/circleci: ourpipeline/approve-long
	// ci/circleci: approve-long vs ci/circleci: ourpipeline/approve-long
	// ci/circleci: build2 vs ci/circleci: ourpipeline/approve-long
	return check.name === githubCheck.name;
}

export async function loadPipeline(pr: PullRequest, checkUrl: string): Promise<Pipeline> {
	const team = httpContext.get('team') as Team

	// console.error('Team is missing Circle token')
	if (!team.circlePersonalToken) throw new Error('Team is missing Circle token');

	// TODO: approval jobs return 404
	const circleCiData = await jobDetails({ jobUrl: checkUrl, token: team.circlePersonalToken })
	assert(circleCiData.raw_job_data.platform === '2.0', 'Unsupported CircleCI version')
	// workflows(workflow_id), build_time_millis, lifecycle, status, previous(build_num, status, build_time_millis), fail_reason, steps(*)

	const pipelineRaw = circleCiData.workflow.raw_workflow_job_data

	const newPipeline = Pipeline.create({pullRequest: pr, rawData: pipelineRaw, sha: pr.headSha})
	await newPipeline.save()
	await newPipeline.reload()

	// console.log('loaded', newPipeline)
	return newPipeline
}

async function updateCommitChecks(commit: Commit, pipelineRaw: any, check: ICommitCheck | null = null) {
	// console.log('updateCommitChecks', pipelineRaw)
	await Promise.all(pipelineRaw.items.map(async (pipelineCheck: {name: string, id: string, status: string, type: string}) => {
		const fullCheckName = CIRCLE_JOB_PREFIX + pipelineCheck.name;
		const [ commitCheck, _ ] = await CommitCheck.findOrCreate<CommitCheck>({commit, type: 'ci-circleci', name: fullCheckName}, {status: pipelineCheck.status})
		// console.log(pipelineCheck, 'vs', commitCheck, 'hook check:', /*check*/)
		// upsert status
		if (commitCheck.status !== pipelineCheck.status) {
			// console.log('updaeting', commitCheck, commitCheck.status, 'to', pipelineCheck.status)
			// commitCheck.status = pipelineCheck.status;

			// await commitCheck.save()
			await CommitCheck.update(commitCheck.id, {status: pipelineCheck.status})
		}

		console.log(fullCheckName, 'vs', check.name)
		// if (check && fullCheckName === check.name) {
		if(check && isSameCheck(commitCheck, check)) {
			commitCheck.rawData = check.raw_data;

			// await commitCheck.save()
			await CommitCheck.update(commitCheck.id, {rawData: check.raw_data})
		}
	}))
}

export async function updatePipeline(pr: PullRequest, commit: Commit, check: ICommitCheck): Promise<void> {
	// const checkName = check.name.replace(CIRCLE_JOB_PREFIX, '');
	// console.log('check name', checkName)

	// if we don't have the pipeline, download it and use its state (prolly more fresh than webhook data)
		// populate the database with checks according to the pipeline data

	// const prPipeline = await Pipeline.findOne({ where: { commit, pullRequest: pr } });
	const prPipeline = await pr.getHeadPipeline();
	// const checks = await CommitCheck.find({where: { commit }})

	// TODO: query this on PR open
	// TODO: race conditions?; add transaction???
	// TODO: race condition when we receive another check webhook?
	if (!prPipeline) {
		console.log('downloading pipeline')
		const pipeline = await loadPipeline(pr, check.target_url)

		await updateCommitChecks(commit, pipeline.rawData, check);

		// newPipeline.reload();
		// return newPipeline;

	// if we already have pipeline data, use the webhook check data to update the single check
	} else {
		console.log('updating check')
		// const singleCheck = await CommitCheck.updateOrCreate({commit, type: 'ci-circleci', name: check.name}, {status: check.status, rawData: check.raw_data});

		const singleCheck = await CommitCheck.findOne({commit, type: 'ci-circleci', name: check.name})

		// approval steps will not be found
		if (!singleCheck) {
			// refresh pipeline
			console.log('missing check', check.name, check.target_url, /*check*/)
			// use target url to parse out workflow ID
			// download workflow and save new pipeline data
			const m = check.target_url.match(/\/workflow-run\/([a-f0-9-]+)/)
			console.log('m', m)

			assert(m && m[1], 'Check URL does not contain workflow')

			const team = httpContext.get('team') as Team

			// console.error('Team is missing Circle token')
			if (!team.circlePersonalToken) throw new Error('Team is missing Circle token');

			const pipeData = await workflowDetails({workflowId: m[1], token: team.circlePersonalToken})

			// const pipeline = Pipeline.create({pullRequest: pr, rawData: pipeData.raw_workflow_job_data})
			const update = await Pipeline.update({pullRequest: pr}, {rawData: pipeData.raw_workflow_job_data})
			if (!update || update.affected < 0) {
				await Pipeline.create({pullRequest: pr, rawData: pipeData.raw_workflow_job_data}).save()
			}

			await updateCommitChecks(commit, pipeData.raw_workflow_job_data, check);
		} else {
			// singleCheck.status = check.status;
			// singleCheck.rawData = check.raw_data;
			// await singleCheck.save();
			await CommitCheck.update(singleCheck.id, {status: check.status, rawData: check.raw_data})
		}

		// return prPipeline;
	}

	// const finalPipeline = await Pipeline.findOneOrFail({ where: { pullRequest: pr }})
	const finalPipeline = await pr.getHeadPipeline()
	assert(finalPipeline, 'Final pipeline not found')

	// then run the pipeline final status check
	const finalStatus = await detectPipelineMasterStatus(pr);
	console.log('final status', finalStatus)


	// 	// TODO: we prolly don't need this anymore
	// 	// if (step.name === checkName) {
	// 	// 	if (step.status !== check.status) {
	// 	// 		console.log('status update', step.status, '->', check.status)
	// 	// 	}
	// 	// }

	// 	// TODO: normalize step.status
	// 	const commitCheck = await CommitCheck.findOrCreate<CommitCheck>({commit, type: 'ci-circleci', name: fullStepName}, {status: step.status})
	// 	console.log('commit check in db', commitCheck)
	// 	// upsert
	// 	if (commitCheck.status !== step.status) {
	// 		commitCheck.status = step.status;
	// 		await commitCheck.save()
	// 	}
	// }))
}

async function detectPipelineMasterStatus(pr: PullRequest) {
	const pipeline = await pr.getHeadPipeline()
	const commit = await pr.getHeadCommit()
	const checks = await CommitCheck.find({where: { commit }})
	// console.log(pr, pipeline, commit, checks)
	assert(checks.length > 0, 'PRs last commit is missing checks')
	console.log('pipe states', checks.map(ch => ch.status))

	const inProgress = checks.some(ch => ch.status === 'queued' || ch.status === 'running' || ch.status === 'pending');
	const failed = !inProgress && checks.some(ch => ch.status === 'failed');
	const success = !inProgress && !failed;
	const actionRequired = checks.some(ch => ch.status === 'on_hold')

	const status = inProgress
		? 'running'
		: failed
			? 'failed'
			: 'success';

	return [status, actionRequired];
}