import { ReviewStateType } from "../entity/PullRequestReview";

export interface ICommitCheck {
  status: 'pending' | 'success' | 'error' | 'failure';
  type: 'standard' | 'check' | 'ci-circleci';
  from: string;
  id: number;
  commit_sha: string;
  name: string;
  target_url: string;
  description: string;
  // context: string;
  pull_request_id: number;
  raw_data: any;
  ci_data: any;
}

export interface IPullRequestEvent {
  id: number;
  from: string;
  pr_number: number;
  website_url: string;
  title: string;
  head_sha: string;
  merged: boolean;
  repository: {
    id: number;
    name: string;
    owner: {
      id: number;
      login: string;
    },
    raw_data: any;
  },
  raw_data: any;
}

export interface IPullRequestReviewEvent {
  remoteId: number;
  from: string;
  body: string | null;
  pull_request_id: number;
  state: ReviewStateType;
  website_url: string;
  raw_data: any;
  user: {
    github_login: string;
    github_id: number;
  }
}

export interface IPullRequestReviewRequest {
  pull_request_id: number;
  assignee_user_id: number | undefined;
  review_username: string;
}

export interface IReviewRequestNotification {
  assignee_user_id: number;
  pr_number: number;
  pr_link: string;
  title: string;
  requester_username: string;
}

export interface IPullRequestReviewRequestRemove {
  pull_request_id: number;
  assignee_user_id: number | undefined;
  review_username: string;
}

export interface IRequestGithubReviewLogin {
  user_id: number;
  author_user_id: number;
  pr_number: number;
}
