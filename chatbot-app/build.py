import os 

# parameters
REGION = "ap-southeast-1"
ACCOUNT = ""

# delete all docker images 
os.system("sudo docker system prune -a") 

# build chatbot-app image 
os.system("sudo docker build -t chatbot-app . ")

#  aws ecr login 
os.system(f"aws ecr get-login-password --region {REGION} | sudo docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com")

# get image id 
IMAGE_ID=os.popen("sudo docker images -q chatbot-app:latest").read()

# tag chatbot-app image 
os.system(f"sudo docker tag {IMAGE_ID.strip()} {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/chatbot-app:latest")

# create ecr repository 
os.system(f"aws ecr create-repository --registry-id {ACCOUNT} --repository-name chatbot-app")

# # push image to ecr 
os.system(f"sudo docker push {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/chatbot-app:latest")