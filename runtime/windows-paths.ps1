function Get-RosmontisPhysicalPath([string]$Path) {
    if (!('Rosmontis.Runtime.NativePaths' -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
namespace Rosmontis.Runtime {
    public static class NativePaths {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
            IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle,
            StringBuilder path, uint length, uint flags);
        public static string Resolve(string path) {
            using (SafeFileHandle handle = CreateFile(Path.GetFullPath(path), 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                StringBuilder finalPath = new StringBuilder(32768);
                uint length = GetFinalPathNameByHandle(handle, finalPath, (uint)finalPath.Capacity, 0);
                if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (length >= finalPath.Capacity) throw new IOException("Resolved path is too long.");
                string value = finalPath.ToString();
                if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + value.Substring(8);
                if (value.StartsWith(@"\\?\", StringComparison.Ordinal)) return value.Substring(4);
                return value;
            }
        }
    }
}
"@
    }
    return [Rosmontis.Runtime.NativePaths]::Resolve($Path).TrimEnd('\')
}
