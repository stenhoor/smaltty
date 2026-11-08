// Emits code: import = require and export = need CommonJS.
import fs = require('fs');
import Alias = Some.Name;
declare namespace Some { const Name: number; }
export = fs;
