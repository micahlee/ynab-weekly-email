let ynab = require("ynab");
let AWS = require("aws-sdk");
let mailer = require('nodemailer-promise');
let lambda = new AWS.Lambda();

let endpoint = process.env.AWS_SECRETS_ENDPOINT,
    region = process.env.AWS_SECRETS_REGION;

exports.handler = async (event) => {
    try {
        let api = await getYnabClient();
        let budget = await getBudget(api, process.env.BUDGET_NAME.trim());
        let report = await generateReport(api, budget, process.env.BUDGET_GROUPS.split(/[,;]\s*/));
        let smtpSettings = await getSmtpSettings();
        await emailReport(report, process.env.EMAIL_FROM, process.env.EMAIL_TO, smtpSettings);
    } catch (err) {
        console.log("Failed to generate budget report email: ", err);
    }
}

async function getBudget(ynabAPI, name) {
    let budgetsResponse = await ynabAPI.budgets.getBudgets();
    let budgets = budgetsResponse.data.budgets

    let budget = budgets.find(b => b.name === name);

    return budget;
}

async function generateReport(ynabAPI, budget, budgetGroups) {
    let lowerGroups = budgetGroups.map(group => group.trim().toLowerCase());
    let categoriesResponse = await ynabAPI.categories.getCategories(budget.id);
    let categoryGroups = categoriesResponse.data.category_groups;
    let selectedGroups = categoryGroups.filter(group => {
        return lowerGroups.indexOf(group.name.trim().toLowerCase()) > -1 && group.hidden === false;
    });
   
    let report = '';

    for(let group of selectedGroups) {
        report += `${group.name}\n`;
        report += `-----------------------------------\n`;
        for(let category of group.categories) {
            if(category.budgeted <= 0.0) continue; 

            report += `${category.name} - $${category.balance/1000.0} (${Math.round(category.balance / category.budgeted * 100)}%) remaining\n`;
        }
        report += '\n';
    }

    return report;
}

async function emailReport(report, from, to, smtpSettings) {
    var sendEmail = mailer.config(smtpSettings);
    
    var message = {
        from,
        to,
        subject: `Budget Update`,
        text: report
    };
    
    await sendEmail(message);
}

async function getYnabClient() {
    let personalToken = await getYnabPersonalToken();
    let client = new ynab.API(personalToken);
    return client;
}

async function getYnabPersonalToken() {
    // Create a Secrets Manager client
    let client = new AWS.SecretsManager({
        endpoint: endpoint,
        region: region
    });

    try {
        let secret = await client.getSecretValue({
            SecretId: process.env.AWS_SECRET_YNAB_TOKEN
        }).promise();

        return secret.SecretString;
    } catch (err) {
        console.log("Error retrieving secret: ", err);
    }
}

async function getSmtpSettings() {
    // Create a Secrets Manager client
    let client = new AWS.SecretsManager({
        endpoint: endpoint,
        region: region
    });

    try {
        let secret = await client.getSecretValue({
            SecretId: process.env.AWS_SECRET_SMTP_SETTINGS
        }).promise();

        return JSON.parse(secret.SecretString);
    } catch (err) {
        console.log("Error retrieving secret: ", err);
    }
}