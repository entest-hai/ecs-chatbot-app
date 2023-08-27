#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EcrStack } from "../lib/ecr-stack";
import { EcsBlueGreenStack } from "../lib/ecs-blue-green-stack";
import { EcsDeploymentGroup } from "../lib/ecs-blue-green-stack";
import { CodePipelineBlueGreen } from "../lib/ecs-blue-green-stack";

const app = new cdk.App();

// create an ecr repository
const ecr = new EcrStack(app, "EcrStack", {
  repoName: "entest-chatbot-app",
});

// create an ecs blue green
const ecs = new EcsBlueGreenStack(app, "EcsBlueGreenStack", {
  vpcId: "vpc-0c8e39fd00db3261f",
  vpcName: "RedshiftVpc",
  ecrRepoName: ecr.repoName,
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});

// codedeploy deployment group
const deploy = new EcsDeploymentGroup(app, "EcsDeploymentGroup", {
  service: ecs.service,
  blueTargetGroup: ecs.blueTargetGroup,
  greenTargetGroup: ecs.greenTargetGroup,
  listener: ecs.listener,
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});

// create a pipeline
new CodePipelineBlueGreen(app, "CodePipelineBlueGreen", {
  repoName: "ecs-chatbot-app",
  repoBranch: "master",
  repoOwner: "entest-hai",
  ecrRepoName: ecr.repoName,
  service: ecs.service,
  deploymentGroup: deploy.deploymentGroup,
  env: {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});
