package dev.nicartjay.pokebonk.offline.standard;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Grants the OS package installer read-only access to exactly one verified APK. */
public final class UpdateFileProvider extends ContentProvider {
    private File apk(Uri uri) throws FileNotFoundException {
        if (getContext() == null || !"/update.apk".equals(uri.getPath()) ||
            !(getContext().getPackageName() + ".updates").equals(uri.getAuthority())) {
            throw new FileNotFoundException("Unknown update");
        }
        return new File(getContext().getCacheDir(), "verified-update.apk");
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only update");
        return ParcelFileDescriptor.open(apk(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File file = apk(uri);
            String[] columns = projection == null ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns);
            MatrixCursor.RowBuilder row = cursor.newRow();
            for (String column : columns) row.add(OpenableColumns.DISPLAY_NAME.equals(column) ? "Pokebonk-Offline.apk" : OpenableColumns.SIZE.equals(column) ? file.length() : null);
            return cursor;
        } catch (FileNotFoundException error) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read-only"); }
}
