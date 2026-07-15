export namespace main {
	
	export class AboutInfo {
	    version: string;
	    dataDir: string;
	
	    static createFrom(source: any = {}) {
	        return new AboutInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.dataDir = source["dataDir"];
	    }
	}
	export class ActivityLogEntry {
	    id: number;
	    time: string;
	    operation: string;
	    packageName: string;
	    version?: string;
	    status: string;
	    details?: Record<string, any>;
	    errorDetail?: string;
	    action?: string;
	    name?: string;
	
	    static createFrom(source: any = {}) {
	        return new ActivityLogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.time = source["time"];
	        this.operation = source["operation"];
	        this.packageName = source["packageName"];
	        this.version = source["version"];
	        this.status = source["status"];
	        this.details = source["details"];
	        this.errorDetail = source["errorDetail"];
	        this.action = source["action"];
	        this.name = source["name"];
	    }
	}
	export class ActivityLogPage {
	    items: ActivityLogEntry[];
	    total: number;
	    page: number;
	    pageSize: number;
	
	    static createFrom(source: any = {}) {
	        return new ActivityLogPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], ActivityLogEntry);
	        this.total = source["total"];
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ActivityLogQuery {
	    timeRange: string;
	    page: number;
	    pageSize: number;
	
	    static createFrom(source: any = {}) {
	        return new ActivityLogQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timeRange = source["timeRange"];
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	    }
	}
	export class BucketInfo {
	    name: string;
	    repoURL: string;
	    description?: string;
	    descriptionCustom: boolean;
	    packageCount: number;
	    hasUpdates: boolean;
	    updatesKnown: boolean;
	    checkFailed: boolean;
	    checkError?: string;
	    statusStale: boolean;
	    localCommit: string;
	    remoteCommit: string;
	    lastCheckedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new BucketInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.repoURL = source["repoURL"];
	        this.description = source["description"];
	        this.descriptionCustom = source["descriptionCustom"];
	        this.packageCount = source["packageCount"];
	        this.hasUpdates = source["hasUpdates"];
	        this.updatesKnown = source["updatesKnown"];
	        this.checkFailed = source["checkFailed"];
	        this.checkError = source["checkError"];
	        this.statusStale = source["statusStale"];
	        this.localCommit = source["localCommit"];
	        this.remoteCommit = source["remoteCommit"];
	        this.lastCheckedAt = source["lastCheckedAt"];
	    }
	}
	export class BucketSyncConfig {
	    minutes: number;
	    mode: string;
	    configPath: string;
	    intervalOptions: number[];
	
	    static createFrom(source: any = {}) {
	        return new BucketSyncConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.minutes = source["minutes"];
	        this.mode = source["mode"];
	        this.configPath = source["configPath"];
	        this.intervalOptions = source["intervalOptions"];
	    }
	}
	export class CachePackageInfo {
	    name: string;
	    version: string;
	    installed: string;
	    size: number;
	    fileCount: number;
	
	    static createFrom(source: any = {}) {
	        return new CachePackageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.installed = source["installed"];
	        this.size = source["size"];
	        this.fileCount = source["fileCount"];
	    }
	}
	export class CacheSummary {
	    packageCount: number;
	    totalSize: number;
	    totalFiles: number;
	
	    static createFrom(source: any = {}) {
	        return new CacheSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.packageCount = source["packageCount"];
	        this.totalSize = source["totalSize"];
	        this.totalFiles = source["totalFiles"];
	    }
	}
	export class CatalogBucketInfo {
	    name: string;
	    description: string;
	    packageCount: number;
	
	    static createFrom(source: any = {}) {
	        return new CatalogBucketInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.packageCount = source["packageCount"];
	    }
	}
	export class CatalogBucketsQuery {
	    hideDeprecated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CatalogBucketsQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hideDeprecated = source["hideDeprecated"];
	    }
	}
	export class CatalogPackageInfo {
	    name: string;
	    version: string;
	    description: string;
	    bucket: string;
	    homepage: string;
	    deprecated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CatalogPackageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.bucket = source["bucket"];
	        this.homepage = source["homepage"];
	        this.deprecated = source["deprecated"];
	    }
	}
	export class CatalogPackagePage {
	    items: CatalogPackageInfo[];
	    total: number;
	    page: number;
	    pageSize: number;
	
	    static createFrom(source: any = {}) {
	        return new CatalogPackagePage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], CatalogPackageInfo);
	        this.total = source["total"];
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CatalogPackageQuery {
	    bucket: string;
	    query: string;
	    page: number;
	    pageSize: number;
	    hideDeprecated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CatalogPackageQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bucket = source["bucket"];
	        this.query = source["query"];
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.hideDeprecated = source["hideDeprecated"];
	    }
	}
	export class CatalogResolveRequest {
	    name: string;
	    bucket: string;
	
	    static createFrom(source: any = {}) {
	        return new CatalogResolveRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.bucket = source["bucket"];
	    }
	}
	export class DesktopUpdateInfo {
	    updateAvailable: boolean;
	    currentVersion: string;
	    latestVersion: string;
	    releaseURL: string;
	    downloadURL: string;
	    releaseNotes: string;
	    manual: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new DesktopUpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.updateAvailable = source["updateAvailable"];
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseURL = source["releaseURL"];
	        this.downloadURL = source["downloadURL"];
	        this.releaseNotes = source["releaseNotes"];
	        this.manual = source["manual"];
	        this.error = source["error"];
	    }
	}
	export class DownloadWorkersConfig {
	    workers: number;
	    configPath: string;
	    minWorkers: number;
	    maxWorkers: number;
	    step: number;
	
	    static createFrom(source: any = {}) {
	        return new DownloadWorkersConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workers = source["workers"];
	        this.configPath = source["configPath"];
	        this.minWorkers = source["minWorkers"];
	        this.maxWorkers = source["maxWorkers"];
	        this.step = source["step"];
	    }
	}
	export class GitHubProxyConfig {
	    value: string;
	    envOverride?: string;
	    configPath: string;
	
	    static createFrom(source: any = {}) {
	        return new GitHubProxyConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.envOverride = source["envOverride"];
	        this.configPath = source["configPath"];
	    }
	}
	export class InstallManifestInfo {
	    manifestPath: string;
	    manifestJSON: string;
	    bucketManifestJSON: string;
	    version: string;
	    downloadUrls: string[];
	    bucketDownloadUrls: string[];
	    urlOverrideActive: boolean;
	    jsonOverrideActive: boolean;
	    jsonOverrideStale: boolean;
	    hashes: string[];
	    architecture?: string;
	    availableArchitectures?: string[];
	    defaultArchitecture?: string;
	    hasInstallerScript?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InstallManifestInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.manifestPath = source["manifestPath"];
	        this.manifestJSON = source["manifestJSON"];
	        this.bucketManifestJSON = source["bucketManifestJSON"];
	        this.version = source["version"];
	        this.downloadUrls = source["downloadUrls"];
	        this.bucketDownloadUrls = source["bucketDownloadUrls"];
	        this.urlOverrideActive = source["urlOverrideActive"];
	        this.jsonOverrideActive = source["jsonOverrideActive"];
	        this.jsonOverrideStale = source["jsonOverrideStale"];
	        this.hashes = source["hashes"];
	        this.architecture = source["architecture"];
	        this.availableArchitectures = source["availableArchitectures"];
	        this.defaultArchitecture = source["defaultArchitecture"];
	        this.hasInstallerScript = source["hasInstallerScript"];
	    }
	}
	export class InstallPlanItem {
	    ref: string;
	    label?: string;
	    installed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InstallPlanItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = source["ref"];
	        this.label = source["label"];
	        this.installed = source["installed"];
	    }
	}
	export class InstallPlan {
	    package: string;
	    depends: InstallPlanItem[];
	    suggestions: InstallPlanItem[];
	    manifest: InstallManifestInfo;
	    localActivateVersion?: string;
	
	    static createFrom(source: any = {}) {
	        return new InstallPlan(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.package = source["package"];
	        this.depends = this.convertValues(source["depends"], InstallPlanItem);
	        this.suggestions = this.convertValues(source["suggestions"], InstallPlanItem);
	        this.manifest = this.convertValues(source["manifest"], InstallManifestInfo);
	        this.localActivateVersion = source["localActivateVersion"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class InstalledPackage {
	    name: string;
	    version: string;
	    latestVersion?: string;
	    updateAvailable: boolean;
	    installedAt: string;
	    bucket: string;
	    description: string;
	    homepage: string;
	    installSize: number;
	    versionLocked: boolean;
	
	    static createFrom(source: any = {}) {
	        return new InstalledPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.latestVersion = source["latestVersion"];
	        this.updateAvailable = source["updateAvailable"];
	        this.installedAt = source["installedAt"];
	        this.bucket = source["bucket"];
	        this.description = source["description"];
	        this.homepage = source["homepage"];
	        this.installSize = source["installSize"];
	        this.versionLocked = source["versionLocked"];
	    }
	}
	export class KnownBucketInfo {
	    name: string;
	    repoURL: string;
	    installed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new KnownBucketInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.repoURL = source["repoURL"];
	        this.installed = source["installed"];
	    }
	}
	export class PackageInfo {
	    name: string;
	    version: string;
	    description: string;
	    bucket: string;
	    homepage: string;
	    license: string;
	
	    static createFrom(source: any = {}) {
	        return new PackageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.bucket = source["bucket"];
	        this.homepage = source["homepage"];
	        this.license = source["license"];
	    }
	}
	export class PackageLaunchEntry {
	    label: string;
	    path: string;
	    relPath: string;
	    autoKind: string;
	    kind: string;
	    userSet: boolean;
	    openable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PackageLaunchEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.autoKind = source["autoKind"];
	        this.kind = source["kind"];
	        this.userSet = source["userSet"];
	        this.openable = source["openable"];
	    }
	}
	export class PackageLauncher {
	    label: string;
	    path: string;
	    kind?: string;
	
	    static createFrom(source: any = {}) {
	        return new PackageLauncher(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.path = source["path"];
	        this.kind = source["kind"];
	    }
	}
	export class PackageVersionEntry {
	    version: string;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PackageVersionEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.active = source["active"];
	    }
	}
	export class PackageVersionsInfo {
	    name: string;
	    activeVersion: string;
	    versionLocked: boolean;
	    versions: PackageVersionEntry[];
	
	    static createFrom(source: any = {}) {
	        return new PackageVersionsInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.activeVersion = source["activeVersion"];
	        this.versionLocked = source["versionLocked"];
	        this.versions = this.convertValues(source["versions"], PackageVersionEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SearchResult {
	    packages: PackageInfo[];
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new SearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.packages = this.convertValues(source["packages"], PackageInfo);
	        this.total = source["total"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StatsQuery {
	    forceRefresh: boolean;
	    hideDeprecated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StatsQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.forceRefresh = source["forceRefresh"];
	        this.hideDeprecated = source["hideDeprecated"];
	    }
	}

}

