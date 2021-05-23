const BaseSyncTarget = require('./BaseSyncTarget').default;
const { _ } = require('./locale');
const Setting = require('./models/Setting').default;
const { FileApi } = require('./file-api.js');
const Synchronizer = require('./Synchronizer').default;
const { FileApiDriverAmazonS3 } = require('./file-api-driver-amazon-s3.js');
const AWS = require('aws-sdk');
const S3 = require('aws-sdk/clients/s3');

class SyncTargetAmazonS3 extends BaseSyncTarget {
	static id() {
		return 8;
	}

	static supportsConfigCheck() {
		return true;
	}

	constructor(db, options = null) {
		super(db, options);
		this.api_ = null;
	}

	static targetName() {
		return 'amazon_s3';
	}

	static label() {
		return `${_('AWS S3')} (Beta)`;
	}

	async isAuthenticated() {
		return true;
	}

	static s3BucketName() {
		return Setting.value('sync.8.path');
	}

	/**
	 * Returns appropriate S3 credential object to use.
	 *
	 * Explicitly configured access keys will take precedence over a configured
	 *   AWS shared credential file.
	 *
	 * @link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html
	 * @link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SharedIniFileCredentials.html
	 *
	 * @return {AWS.Credentials} AWS credentials to use.
	 */
	static s3Credentials() {
		const accessKeyId = Setting.value('sync.8.username');
		const secretAccessKey = Setting.value('sync.8.password');
		const credentialPath = Setting.value('sync.8.sharedCredentialFile');
		if ([accessKeyId, secretAccessKey].every((s) => { return s !== ''; })) {
			// If an access key ID and secret access key specified, use those
			return new AWS.Credentials(accessKeyId, secretAccessKey);
		} else if (credentialPath !== '') {
			// Else use shared credential file if specified
			return new AWS.SharedIniFileCredentials({
				profile: Setting.value('sync.8.profile'),
				filename: credentialPath,
			});
		} else {
			// Else throw exception for invalid credential settings
			throw new Error('No valid S3 credentials specified.');
		}
	}

	/**
	 * Returns configuration object for the AWS/S3 SDK to use.
	 *
	 * @link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html
	 * @link https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor-property
	 *
	 * @returns {AWS.Config} AWS S3 configuration.
	 */
	static s3Config() {
		return new AWS.Config({
			credentials: SyncTargetAmazonS3.s3Credentials(),
			s3UseArnRegion: true,
			s3ForcePathStyle: true,
			endpoint: Setting.value('sync.8.url'),
		});
	}

	api() {
		if (this.api_) return this.api_;

		this.api_ = new S3(SyncTargetAmazonS3.s3Config());
		return this.api_;
	}

	static async newFileApi_(syncTargetId, _options) {
		const api = new S3(SyncTargetAmazonS3.s3Config());
		const driver = new FileApiDriverAmazonS3(api, SyncTargetAmazonS3.s3BucketName());
		const fileApi = new FileApi('', driver);
		fileApi.setSyncTargetId(syncTargetId);
		return fileApi;
	}

	static async checkConfig(options) {
		const fileApi = await SyncTargetAmazonS3.newFileApi_(SyncTargetAmazonS3.id(), options);
		fileApi.requestRepeatCount_ = 0;

		const output = {
			ok: false,
			errorMessage: '',
		};

		try {
			const headBucketReq = new Promise((resolve, reject) => {
				fileApi.driver().api().headBucket({
					Bucket: options.path(),
				},(err, response) => {
					if (err) reject(err);
					else resolve(response);
				});
			});
			const result = await headBucketReq;
			if (!result) throw new Error(`AWS S3 bucket not found: ${SyncTargetAmazonS3.s3BucketName()}`);
			output.ok = true;
		} catch (error) {
			output.errorMessage = error.message;
			if (error.code) output.errorMessage += ` (Code ${error.code})`;
		}

		return output;
	}

	async initFileApi() {
		const appDir = '';
		const fileApi = new FileApi(appDir, new FileApiDriverAmazonS3(this.api(), SyncTargetAmazonS3.s3BucketName()));
		fileApi.setSyncTargetId(SyncTargetAmazonS3.id());

		return fileApi;
	}

	async initSynchronizer() {
		return new Synchronizer(this.db(), await this.fileApi(), Setting.value('appType'));
	}
}

module.exports = SyncTargetAmazonS3;
