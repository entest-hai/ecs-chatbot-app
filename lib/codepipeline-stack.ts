import {
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_codebuild,
  aws_codecommit,
  aws_codepipeline,
  aws_codepipeline_actions,
  aws_ecr,
  aws_ecs,
  aws_iam,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";

interface CodePipelineProps extends StackProps {
  readonly connectArn?: string;
  readonly repoName: string;
  readonly repoBranch: string;
  readonly repoOwner: string;
  readonly ecrRepoName: string;
  readonly service: aws_ecs.FargateService;
}

export class CodePipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: CodePipelineProps) {
    super(scope, id, props);

    // code commit
    const codecommitRepository = new aws_codecommit.Repository(
      this,
      "CodeCommitChatbot",
      {
        repositoryName: props.repoName,
      }
    );

    // ecr repository
    const ecrRepository = new aws_ecr.Repository(
      this,
      "EcrRepositoryForChatbot",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        repositoryName: props.ecrRepoName,
        autoDeleteImages: true,
      }
    );

    // artifact - source code
    const sourceOutput = new aws_codepipeline.Artifact("SourceOutput");

    // artifact - codebuild output
    const codeBuildOutput = new aws_codepipeline.Artifact("CodeBuildOutput");

    // codebuild role push ecr image
    const codebuildRole = new aws_iam.Role(this, "RoleForCodeBuildChatbotApp", {
      roleName: "RoleForCodeBuildChatbotApp",
      assumedBy: new aws_iam.ServicePrincipal("codebuild.amazonaws.com"),
    });

    ecrRepository.grantPullPush(codebuildRole);

    // codebuild - build ecr image
    const ecrBuild = new aws_codebuild.PipelineProject(
      this,
      "BuildChatbotEcrImage",
      {
        projectName: "BuildChatbotEcrImage",
        role: codebuildRole,
        environment: {
          privileged: true,
          buildImage: aws_codebuild.LinuxBuildImage.STANDARD_5_0,
          computeType: aws_codebuild.ComputeType.MEDIUM,
          environmentVariables: {
            ACCOUNT_ID: {
              value: this.account,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            REGION: {
              value: this.region,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            REPO_NAME: {
              value: props.ecrRepoName,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            TAG: {
              value: "demo",
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
          },
        },

        // cdk upload build_spec.yaml to s3
        buildSpec: aws_codebuild.BuildSpec.fromAsset(
          path.join(__dirname, "./build_spec.yaml")
        ),
      }
    );

    // code pipeline
    new aws_codepipeline.Pipeline(this, "CodePipelineChatbot", {
      pipelineName: "CodePipelineChatbot",
      // cdk automatically creates role for codepipeline
      // role: pipelineRole,
      stages: [
        // source
        {
          stageName: "SourceCode",
          actions: [
            // new aws_codepipeline_actions.CodeStarConnectionsSourceAction({
            //   actionName: "GitHub",
            //   owner: props.repoOwner,
            //   repo: props.repoName,
            //   branch: props.repoBranch,
            //   connectionArn: props.connectArn,
            //   output: sourceOutput,
            // }),

            new aws_codepipeline_actions.CodeCommitSourceAction({
              actionName: "CodeCommitChatbot",
              repository: codecommitRepository,
              branch: "main",
              output: sourceOutput,
            }),
          ],
        },

        // build docker image and push to ecr
        {
          stageName: "BuildChatbotEcrImageStage",
          actions: [
            new aws_codepipeline_actions.CodeBuildAction({
              actionName: "BuildChatbotEcrImage",
              project: ecrBuild,
              input: sourceOutput,
              outputs: [codeBuildOutput],
            }),
          ],
        },

        // deploy new tag image to ecs service
        {
          stageName: "EcsCodeDeploy",
          actions: [
            new aws_codepipeline_actions.EcsDeployAction({
              // role: pipelineRole,
              actionName: "Deploy",
              service: props.service,
              input: codeBuildOutput,
              // imageFile: codeBuildOutput.atPath(""),
              deploymentTimeout: Duration.minutes(10),
            }),
          ],
        },
      ],
    });
  }
}
