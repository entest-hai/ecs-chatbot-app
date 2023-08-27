import {
  aws_codedeploy,
  aws_ec2,
  aws_ecr,
  aws_ecs,
  aws_elasticloadbalancingv2,
  aws_iam,
  aws_codebuild,
  aws_codecommit,
  aws_codepipeline,
  aws_codepipeline_actions,
  Duration,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import * as path from "path";
import { FargatePlatformVersion } from "aws-cdk-lib/aws-ecs";
import { Effect } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface EcsProps extends StackProps {
  vpcId: string;
  vpcName: string;
  ecrRepoName: string;
}

export class EcsBlueGreenStack extends Stack {
  public readonly service: aws_ecs.FargateService;
  public readonly listener: aws_elasticloadbalancingv2.ApplicationListener;
  public readonly blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  public readonly greenTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: EcsProps) {
    super(scope, id, props);

    // lookup an existed vpc
    const vpc = aws_ec2.Vpc.fromLookup(this, "LookUpVpc", {
      vpcId: props.vpcId,
      vpcName: props.vpcName,
    });

    // application load balancer
    const alb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "AlbForEcs",
      {
        loadBalancerName: "AlbForEcsDemo",
        vpc: vpc,
        internetFacing: true,
      }
    );

    // add product listener
    const prodListener = alb.addListener("ProdListener", {
      port: 80,
      open: true,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    const testListener = alb.addListener("TestListener", {
      port: 8080,
      open: true,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    prodListener.connections.allowDefaultPortFromAnyIpv4("");
    testListener.connections.allowDefaultPortFromAnyIpv4("");

    // blue target group
    const blueTargetGroup =
      new aws_elasticloadbalancingv2.ApplicationTargetGroup(
        this,
        "GlueTargetGroup",
        {
          targetType: aws_elasticloadbalancingv2.TargetType.IP,
          port: 80,
          healthCheck: {
            timeout: Duration.seconds(20),
            interval: Duration.seconds(35),
            path: "/",
            protocol: aws_elasticloadbalancingv2.Protocol.HTTP,
          },
          vpc: vpc,
        }
      );

    // green target group
    const greenTargetGroup =
      new aws_elasticloadbalancingv2.ApplicationTargetGroup(
        this,
        "GreenTargetGroup",
        {
          targetType: aws_elasticloadbalancingv2.TargetType.IP,
          healthCheck: {
            timeout: Duration.seconds(20),
            interval: Duration.seconds(35),
            path: "/",
            protocol: aws_elasticloadbalancingv2.Protocol.HTTP,
          },
          port: 80,
          vpc: vpc,
        }
      );

    prodListener.addTargetGroups("GlueTargetGroup", {
      targetGroups: [blueTargetGroup],
    });

    testListener.addTargetGroups("GreenTargetGroup", {
      targetGroups: [greenTargetGroup],
    });

    // ecs cluster
    const cluster = new aws_ecs.Cluster(this, "EcsClusterForWebServer", {
      vpc: vpc,
      clusterName: "EcsClusterForWebServer",
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });

    // task role pull ecr image
    const executionRole = new aws_iam.Role(
      this,
      "RoleForEcsTaskToPullEcrChatbotImage",
      {
        assumedBy: new aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        roleName: "RoleForEcsTaskToPullEcrChatbotImage",
      }
    );

    executionRole.addToPolicy(
      new aws_iam.PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecr:*"],
        resources: ["*"],
      })
    );

    // ecs task definition
    const task = new aws_ecs.FargateTaskDefinition(
      this,
      "TaskDefinitionForWeb",
      {
        family: "latest",
        cpu: 2048,
        memoryLimitMiB: 4096,
        runtimePlatform: {
          operatingSystemFamily: aws_ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: aws_ecs.CpuArchitecture.X86_64,
        },
        // taskRole: "",
        // retrieve container images from ECR
        executionRole: executionRole,
      }
    );

    // taask add container
    task.addContainer("NextChatbotContainer", {
      containerName: "entest-chatbot-app",
      memoryLimitMiB: 4096,
      memoryReservationMiB: 4096,
      stopTimeout: Duration.seconds(120),
      startTimeout: Duration.seconds(120),
      environment: {
        FHR_ENV: "DEPLOY",
      },
      image: aws_ecs.ContainerImage.fromRegistry(
        "public.ecr.aws/b5v7e4v7/entest-chatbot-app:latest"
      ),
      // image: aws_ecs.ContainerImage.fromEcrRepository(
      //   aws_ecr.Repository.fromRepositoryName(
      //     this,
      //     "entest-chatbot-app",
      //     props.ecrRepoName
      //   )
      // ),
      portMappings: [{ containerPort: 3000 }],
    });

    // service
    const service = new aws_ecs.FargateService(this, "ChatbotService", {
      vpcSubnets: {
        subnetType: aws_ec2.SubnetType.PUBLIC,
      },
      assignPublicIp: true,
      cluster: cluster,
      taskDefinition: task,
      desiredCount: 2,
      deploymentController: {
        type: aws_ecs.DeploymentControllerType.CODE_DEPLOY,
      },
      capacityProviderStrategies: [
        {
          capacityProvider: "FARGATE",
          weight: 1,
        },
        {
          capacityProvider: "FARGATE_SPOT",
          weight: 0,
        },
      ],
      platformVersion: FargatePlatformVersion.LATEST,
    });

    // attach service to target group
    service.connections.allowFrom(alb, aws_ec2.Port.tcp(80));
    service.connections.allowFrom(alb, aws_ec2.Port.tcp(8080));
    service.attachToApplicationTargetGroup(blueTargetGroup);

    // exported
    this.service = service;
    this.listener = prodListener;
    this.blueTargetGroup = blueTargetGroup;
    this.greenTargetGroup = greenTargetGroup;
  }
}

interface EcsDeploymentProps extends StackProps {
  service: aws_ecs.FargateService;
  blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  greenTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  listener: aws_elasticloadbalancingv2.ApplicationListener;
}

export class EcsDeploymentGroup extends Stack {
  public readonly deploymentGroup: aws_codedeploy.EcsDeploymentGroup;

  constructor(scope: Construct, id: string, props: EcsDeploymentProps) {
    super(scope, id, props);

    const service = props.service;
    const blueTargetGroup = props.blueTargetGroup;
    const greenTargetGroup = props.greenTargetGroup;
    const listener = props.listener;

    this.deploymentGroup = new aws_codedeploy.EcsDeploymentGroup(
      this,
      "BlueGreenDeploymentGroup",
      {
        service: service,
        blueGreenDeploymentConfig: {
          blueTargetGroup,
          greenTargetGroup,
          listener,
        },
        deploymentConfig: aws_codedeploy.EcsDeploymentConfig.ALL_AT_ONCE,
      }
    );
  }
}

interface CodePipelineBlueGreenProps extends StackProps {
  readonly connectArn?: string;
  readonly repoName: string;
  readonly repoBranch: string;
  readonly repoOwner: string;
  readonly ecrRepoName: string;
  readonly service: aws_ecs.FargateService;
  readonly deploymentGroup: aws_codedeploy.EcsDeploymentGroup;
}

export class CodePipelineBlueGreen extends Stack {
  constructor(scope: Construct, id: string, props: CodePipelineBlueGreenProps) {
    super(scope, id, props);

    // code commit
    const codecommitRepository = new aws_codecommit.Repository(
      this,
      "CodeCommitChatbot",
      {
        repositoryName: props.repoName,
      }
    );

    const ecrRepository = aws_ecr.Repository.fromRepositoryName(
      this,
      "EcrRepositoryForChatbot",
      props.ecrRepoName
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
        // {
        //   stageName: "EcsCodeDeploy",
        //   actions: [
        //     new aws_codepipeline_actions.EcsDeployAction({
        //       // role: pipelineRole,
        //       actionName: "Deploy",
        //       service: props.service,
        //       input: codeBuildOutput,
        //       // imageFile: codeBuildOutput.atPath(""),
        //       deploymentTimeout: Duration.minutes(10),
        //     }),
        //   ],
        // },
        {
          stageName: "EcsCodeDeployBlueGreen",
          actions: [
            new aws_codepipeline_actions.CodeDeployEcsDeployAction({
              actionName: "EcsDeployGlueGreen",
              deploymentGroup: props.deploymentGroup,
              // file name shoulde be appspec.yaml
              appSpecTemplateInput: sourceOutput,
              // update task definition
              containerImageInputs: [
                {
                  // should contain imageDetail.json
                  input: codeBuildOutput,
                  taskDefinitionPlaceholder: "IMAGE1_NAME",
                },
              ],
              // should be taskdef.json
              taskDefinitionTemplateInput: sourceOutput,
              // variablesNamespace: ''
            }),
          ],
        },
      ],
    });
  }
}
