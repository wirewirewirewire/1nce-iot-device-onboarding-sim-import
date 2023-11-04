# 1nce-iot-device-onboarding-sim-import
This tool gives you the ability to import your existing 1nce onboarding infrastructure in the new self-hostet deployment : https://github.com/1NCE-GmbH/1nce-iot-device-onboarding#input-parameters



### Requirements

- 1nce OS is connected with your aws
- the new 1nce iot device onboarding is setup in aws (check link)
- you run a local environment with aws-cli and nodejs 16



### Setup

In the main.js you need to fillout the following ENV

`ONCE_BUCKET_NAME` this is the bucket with all your certs from the exisiting 1nce onboarding. it looks like once-sim-aws-customerfullintresource-xxx"
`IOT_SIM_TABLE` the dynamodb table created by the new deployment. It looks like "sim-metastore"
`ONCE_API_TOKEN` Access token to use 1nce API and get SIM card infos. check: https://help.1nce.com/dev-hub/reference/postaccesstokenpost
`SIM_COUNT` the maximum number of sim pages to proccess. 1 Page is 100 SIMs. If the Value is 10 you will import maximum 1000 SIM cards. Use a low value to test everything.



### RUN

Run in your Terminal

`npm install`

`npm run start`



If everything goes well you will see no errors and you can check the dynamodb table with the new devices. 
